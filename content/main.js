/**
 * 极简 HLS 播放器：捕获页面 m3u8 → 全屏原生 <video controls> 直接播放
 * 快捷键/控制条全部用浏览器原生控件（点击视频后 Space/←→/↑↓/M/F 可用）
 */
(() => {
  if (window.__AVP_PLAYER__) return;
  window.__AVP_PLAYER__ = true;

  const MARKER = '__AVP_M3U8__';
  let latestUrl = null;
  let hls = null;
  let host = null;
  let video = null;
  let userClosed = false;
  let loadSeq = 0;
  const vodCache = new Map(); // 原始 m3u8 URL → VOD 化后的地址，避免重复拉清单

  function open() {
    if (!host) {
      host = document.createElement('div');
      host.id = 'avp-host';
      Object.assign(host.style, {
        position: 'fixed', inset: 0, zIndex: 2147483647,
        background: 'rgba(0,0,0,.92)', display: 'none'
      });
      video = document.createElement('video');
      video.controls = true;
      Object.assign(video.style, { width: '100%', height: '100%', background: '#000' });
      const close = document.createElement('button');
      close.textContent = '✕ 关闭';
      Object.assign(close.style, {
        position: 'absolute', top: '12px', right: '16px', zIndex: '2',
        padding: '6px 14px', borderRadius: '8px', border: '1px solid #555',
        background: 'rgba(30,30,30,.8)', color: '#eee', fontSize: '14px', cursor: 'pointer'
      });
      close.addEventListener('click', closePlayer);
      host.appendChild(video);
      host.appendChild(close);
      document.documentElement.appendChild(host);
      video.addEventListener('dblclick', () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (host.requestFullscreen) host.requestFullscreen().catch(() => {});
      });
    }
    host.style.display = '';
    userClosed = false;
    // 暂停网站自身播放器，避免双重声音
    document.querySelectorAll('video').forEach((v) => { if (v !== video) { try { v.pause(); } catch (e) {} } });
    if (!latestUrl) { host.style.display = 'none'; return; }
    load(latestUrl);
  }

  /* ---------- 假直播转 VOD ---------- */

  function fetchText(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    return fetch(url, { signal: ctl.signal }).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).finally(() => clearTimeout(timer));
  }

  // 分片/子清单地址绝对化，末尾追加 ENDLIST，让 hls.js 按 VOD 处理（进度条完整可拖）
  // 注意：真·滚动窗口直播会被定格为当前窗口快照
  function absolutize(text, baseUrl) {
    const lines = text.split('\n').map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        if (t.startsWith('#EXT-X-MAP')) {
          return t.replace(/URI="([^"]+)"/, (m, u) => 'URI="' + new URL(u, baseUrl).href + '"');
        }
        return line;
      }
      try { return new URL(t, baseUrl).href; } catch (e) { return line; }
    });
    return lines.join('\n') + '\n#EXT-X-ENDLIST\n';
  }

  // master 清单里挑带宽最高的变体子清单
  function pickVariant(text, baseUrl) {
    const lines = text.split('\n');
    let best = null, bestBw = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim().startsWith('#EXT-X-STREAM-INF')) continue;
      const m = /BANDWIDTH=(\d+)/.exec(lines[i]);
      const bw = m ? +m[1] : 0;
      for (let j = i + 1; j < lines.length; j++) {
        const u = lines[j].trim();
        if (!u) continue;
        if (u.startsWith('#')) break;
        if (bw > bestBw) { bestBw = bw; best = u; }
        break;
      }
    }
    return best ? new URL(best, baseUrl).href : null;
  }

  // 无 ENDLIST 的清单转成 VOD blob；已是 VOD 则直接用原地址
  async function toVodUrl(url) {
    if (vodCache.has(url)) return vodCache.get(url);
    const text = await fetchText(url);
    let result;
    if (/#EXT-X-ENDLIST/.test(text)) {
      result = url;
    } else if (/#EXT-X-STREAM-INF/.test(text)) {
      const sub = pickVariant(text, url);
      result = sub ? await toVodUrl(sub) : url;
    } else {
      result = URL.createObjectURL(new Blob([absolutize(text, url)], { type: 'application/vnd.apple.mpegurl' }));
    }
    vodCache.set(url, result);
    return result;
  }

  async function load(url) {
    const seq = ++loadSeq;
    let src = url;
    try { src = await toVodUrl(url); } catch (e) { src = url; } // 转换失败（CORS/超时等）回退原始地址
    if (seq !== loadSeq) return; // 期间有更新的加载/关闭操作，丢弃本次结果
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src; // Safari
    }
    // 不自动播放：预载缓冲，等用户手动点播放（保持有声状态）
  }

  function closePlayer() {
    loadSeq++; // 取消仍在进行的 load，防止关闭后又被旧结果接管
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    try { video.pause(); } catch (e) {}
    host.style.display = 'none';
    userClosed = true;
  }

  // 接收 MAIN world 捕获的 m3u8
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== MARKER || d.type !== 'm3u8') return;
    let url = d.url;
    try { url = new URL(url, location.href).href; } catch (e) { /* keep raw */ }
    const changed = url !== latestUrl;
    latestUrl = url;
    try { chrome.storage.local.set({ avpLastUrl: url, avpLastAt: d.at || Date.now() }); } catch (e) {}
    const isOpen = host && host.style.display !== 'none';
    if (!isOpen) {
      if (!userClosed || changed) open();       // 直接播放：捕获到即自动弹出
    } else if (changed) {
      load(url);                                // 已打开且换了流 → 直接切
    }
  });

  /* ---------- 全局快捷键兜底：无需 video 聚焦 ---------- */
  document.addEventListener('keydown', (e) => {
    if (!host || host.style.display === 'none') return;
    const t = e.target;
    if (t === video) return; // 焦点在视频上时交给原生控件，避免双重快进
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable)) return;
    const dur = video.duration;
    const maxT = (dur && isFinite(dur)) ? dur : Infinity;
    switch (e.key) {
      case 'ArrowLeft': video.currentTime = Math.max(0, video.currentTime - 5); e.preventDefault(); break;
      case 'ArrowRight': video.currentTime = Math.min(maxT, video.currentTime + 5); e.preventDefault(); break;
      case 'ArrowUp': video.volume = Math.min(1, video.volume + 0.1); e.preventDefault(); break;
      case 'ArrowDown': video.volume = Math.max(0, video.volume - 0.1); e.preventDefault(); break;
      case ' ': case 'k': case 'K':
        if (video.paused) video.play().catch(() => {}); else video.pause();
        e.preventDefault(); break;
      case 'm': case 'M': video.muted = !video.muted; e.preventDefault(); break;
      case 'f': case 'F':
        if (document.fullscreenElement) document.exitFullscreen();
        else if (host.requestFullscreen) host.requestFullscreen().catch(() => {});
        e.preventDefault(); break;
    }
  });

  // popup 指令
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.cmd === 'open') { open(); sendResponse({ ok: true }); }
    else if (msg && msg.cmd === 'getStatus') { sendResponse({ hasUrl: !!latestUrl, url: latestUrl }); }
    return true;
  });
})();

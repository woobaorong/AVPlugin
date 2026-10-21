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

  function load(url) {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (window.Hls && window.Hls.isSupported()) {
      hls = new window.Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url; // Safari
    }
    // 不自动播放：预载缓冲，等用户手动点播放（保持有声状态）
  }

  function closePlayer() {
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

  // popup 指令
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.cmd === 'open') { open(); sendResponse({ ok: true }); }
    else if (msg && msg.cmd === 'getStatus') { sendResponse({ hasUrl: !!latestUrl, url: latestUrl }); }
    return true;
  });
})();

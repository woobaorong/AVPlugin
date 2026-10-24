/**
 * 迅雷网盘文件列表增强（隔离世界）：
 * - 每个 MP4/视频条目右侧注入 ▶ 播放按钮（data-file-id 定位文件）
 * - 自带极简播放器：Space 暂停 / 左键快退 5s / 右键快进 5s / 进度条 / Esc 关闭
 * 直链通过 window.postMessage 向 MAIN world 钩子（xunlei-hook.js）索取
 */
(() => {
  if (window.__AVP_XLP_UI__) return;
  window.__AVP_XLP_UI__ = true;

  const MARKER = '__AVP_XLP__';
  const VIDEO_RE = /\.(mp4|mkv|mov|m4v|avi|wmv|flv|ts|webm|rmvb)$/i;
  const ROW_SEL = 'li[class*="SourceListItem__item"]';
  const NAME_SEL = '[class*="SourceListItem__name"]';

  /* ================= 列表扫描与播放按钮注入 ================= */

  function scan() {
    document.querySelectorAll(ROW_SEL).forEach((row) => {
      if (row.querySelector('.avp-play-btn')) return;
      const idEl = row.hasAttribute('data-file-id') ? row : row.querySelector('[data-file-id]');
      const nameEl = row.querySelector(NAME_SEL);
      const name = nameEl ? nameEl.textContent.trim() : '';
      if (!idEl || !VIDEO_RE.test(name)) return;
      if (getComputedStyle(row).position === 'static') row.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className = 'avp-play-btn';
      btn.textContent = '▶';
      btn.title = '用 AVP 播放器播放';
      Object.assign(btn.style, {
        position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
        width: '26px', height: '26px', lineHeight: '24px', padding: '0',
        borderRadius: '50%', border: '1px solid rgba(120,220,140,.6)',
        background: 'rgba(20,60,30,.85)', color: '#7ef29d', fontSize: '11px',
        cursor: 'pointer', zIndex: '5', opacity: '0.45'
      });
      btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
      btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.45'; });
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        play(name, idEl.getAttribute('data-file-id'), btn);
      });
      row.appendChild(btn);
    });
  }

  let scanTimer = 0;
  function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 300); }
  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  scheduleScan();

  /* ================= 播放器 UI ================= */

  let host, video, titleEl, playBtn, fill, track, timeEl, toastEl;
  let seq = 0;              // 加载序号，丢弃过期的直链响应
  let pendingGet = null;    // 等待中的取直链请求 { id, btn, cb }

  function ensureUI() {
    if (host) return;

    host = document.createElement('div');
    Object.assign(host.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', display: 'none',
      background: 'rgba(0,0,0,.93)'
    });

    video = document.createElement('video');
    Object.assign(video.style, {
      position: 'absolute', left: '0', right: '0', top: '0', bottom: '44px',
      width: '100%', height: '100%', objectFit: 'contain',
      background: '#000', outline: 'none'
    });

    titleEl = document.createElement('div');
    Object.assign(titleEl.style, {
      position: 'absolute', top: '12px', left: '16px', right: '110px',
      color: '#ddd', fontSize: '14px', overflow: 'hidden',
      textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none'
    });

    const close = document.createElement('button');
    close.textContent = '✕ 关闭 (Esc)';
    Object.assign(close.style, {
      position: 'absolute', top: '10px', right: '14px', padding: '5px 12px',
      borderRadius: '8px', border: '1px solid #555', background: 'rgba(30,30,30,.85)',
      color: '#eee', fontSize: '13px', cursor: 'pointer'
    });
    close.addEventListener('click', closePlayer);

    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'absolute', left: '0', right: '0', bottom: '0', height: '44px',
      display: 'flex', alignItems: 'center', gap: '10px', padding: '0 14px',
      background: 'rgba(10,10,10,.78)'
    });
    playBtn = document.createElement('button');
    playBtn.textContent = '▶';
    playBtn.title = '播放/暂停 (Space)';
    Object.assign(playBtn.style, {
      width: '28px', height: '28px', borderRadius: '50%', border: 'none',
      background: 'transparent', color: '#fff', fontSize: '14px', cursor: 'pointer',
      flexShrink: '0', padding: '0'
    });
    playBtn.addEventListener('click', togglePlay);
    track = document.createElement('div');
    Object.assign(track.style, {
      flex: '1', height: '6px', borderRadius: '3px', position: 'relative',
      background: 'rgba(255,255,255,.2)', cursor: 'pointer'
    });
    fill = document.createElement('div');
    Object.assign(fill.style, {
      position: 'absolute', left: '0', top: '0', bottom: '0', width: '0%',
      borderRadius: '3px', background: '#4ade80'
    });
    track.appendChild(fill);
    timeEl = document.createElement('span');
    Object.assign(timeEl.style, {
      color: '#ccc', fontSize: '12px', minWidth: '120px', textAlign: 'center',
      userSelect: 'none', flexShrink: '0'
    });
    bar.append(playBtn, track, timeEl);

    host.append(video, titleEl, close, bar);
    document.documentElement.appendChild(host);

    /* 进度条：点击/拖动定位 */
    let dragging = false;
    const seekTo = (e) => {
      if (!isFinite(video.duration)) return;
      const r = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      video.currentTime = ratio * video.duration;
      updateProgress();
    };
    track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); seekTo(e); });
    track.addEventListener('pointermove', (e) => { if (dragging) seekTo(e); });
    track.addEventListener('pointerup', () => { dragging = false; });

    /* 左键 = 播放/暂停；右键 = 快进 5s */
    video.addEventListener('click', () => togglePlay());
    video.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); seekBy(5); });

    video.addEventListener('timeupdate', updateProgress);
    video.addEventListener('play', () => { playBtn.textContent = '⏸'; });
    video.addEventListener('pause', () => { playBtn.textContent = '▶'; });
    video.addEventListener('ended', () => { playBtn.textContent = '▶'; });

    host.addEventListener('click', (e) => { if (e.target === host) closePlayer(); });

    /* 我们的播放器打开期间：任何其他 video 开始播放立即暂停+静音（防止官方播放器同时出声） */
    const silenceOthers = (e) => {
      if (e.target === video) return;
      if (!host || host.style.display === 'none') return;
      try { e.target.pause(); e.target.muted = true; } catch (err) { /* ignore */ }
    };
    document.addEventListener('play', silenceOthers, true);
    document.addEventListener('playing', silenceOthers, true);

    /* 快捷键 */
    document.addEventListener('keydown', (e) => {
      if (e.__avpSynthetic) return; // 插件自己派发的 Esc（用于关闭官方播放器），不要关自己
      if (!host || host.style.display === 'none') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      switch (e.key) {
        case ' ': togglePlay(); e.preventDefault(); break;
        case 'ArrowLeft': seekBy(-5); e.preventDefault(); break;
        case 'ArrowRight': seekBy(5); e.preventDefault(); break;
        case 'ArrowUp': video.volume = Math.min(1, video.volume + 0.1); showToast('音量 ' + Math.round(video.volume * 100) + '%'); e.preventDefault(); break;
        case 'ArrowDown': video.volume = Math.max(0, video.volume - 0.1); showToast('音量 ' + Math.round(video.volume * 100) + '%'); e.preventDefault(); break;
        case 'm': case 'M': video.muted = !video.muted; showToast(video.muted ? '已静音' : '取消静音'); e.preventDefault(); break;
        case 'Escape': closePlayer(); break;
      }
    });
  }

  function fmt(s) {
    if (!isFinite(s)) return '--:--';
    s = Math.floor(s);
    const p = (n) => String(n).padStart(2, '0');
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + ':' + p(m) + ':' + p(s % 60) : p(m) + ':' + p(s % 60);
  }

  function updateProgress() {
    if (isFinite(video.duration) && video.duration > 0) {
      fill.style.width = (video.currentTime / video.duration * 100) + '%';
      timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
    } else {
      timeEl.textContent = fmt(video.currentTime);
    }
  }

  function togglePlay() { if (video.paused) video.play().catch(() => {}); else video.pause(); }

  function seekBy(sec) {
    const dur = video.duration;
    const maxT = (dur && isFinite(dur)) ? dur : Infinity;
    video.currentTime = Math.min(maxT, Math.max(0, video.currentTime + sec));
    showToast((sec > 0 ? '+' : '') + sec + 's');
  }

  function showToast(text) {
    if (!host) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        padding: '6px 16px', borderRadius: '8px', background: 'rgba(0,0,0,.7)',
        color: '#4ade80', fontSize: '18px', pointerEvents: 'none',
        opacity: '0', transition: 'opacity .2s'
      });
      host.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => { toastEl.style.opacity = '0'; }, 600);
  }

  /* ================= 直链获取与播放流程 ================= */

  const urlCache = new Map(); // 本地缓存：id → 直链

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== MARKER) return;

    // 官方播放器取到直链（钩子被动捕获）
    if (d.type === 'vod' && d.url) {
      if (d.id) urlCache.set(d.id, d.url);
      if (expecting && (!d.id || !expecting.id || d.id === expecting.id)) {
        const r = expecting.resolve;
        stopExpecting();
        closeOfficialPlayer();
        r(d.url);
      }
      return;
    }

    if (d.type !== 'auth') return;
    if (!pendingGet || pendingGet.id !== d.id) return;
    const cb = pendingGet.cb;
    pendingGet = null;

    if (d.url) { cb(d.url); return; }                    // 命中钩子缓存的直链
    if (d.error || !d.api) { cb(null, d.error || '未获取到请求信息'); return; }

    // 交给 background 重放 API 取直链（后台不受页面 CORS 限制，Cookie 自动携带）
    try {
      chrome.runtime.sendMessage({ type: 'avpFetchPlayUrl', url: d.api, headers: d.hdrs || {} }, (resp) => {
        if (chrome.runtime.lastError) { cb(null, '扩展通信失败: ' + chrome.runtime.lastError.message); return; }
        cb(resp && resp.url, resp && resp.error);
      });
    } catch (e) {
      cb(null, '扩展上下文失效，请刷新页面重试');
    }
  });

  function play(name, id, btn) {
    ensureUI();
    host.style.display = '';
    startSuppressing(); // 我们的播放器打开期间，官方播放器一律隐形
    if (!document.fullscreenElement && host.requestFullscreen) {
      host.requestFullscreen().catch(() => { /* 全屏被拒绝则保持窗口模式 */ });
    }
    titleEl.textContent = name;
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) { /* ignore */ }
    const mySeq = ++seq;

    const finish = (url, err) => {
      if (btn) btn.textContent = '▶';
      if (mySeq !== seq) return; // 已切换到其他视频或已关闭
      if (url) {
        video.src = url;
        video.play().catch(() => {});
      } else {
        showToast(err || '播放失败');
      }
    };

    if (urlCache.has(id)) { finish(urlCache.get(id)); return; }

    showToast('获取直链中…');
    if (pendingGet && pendingGet.btn) pendingGet.btn.textContent = '▶'; // 复原上一个等待中的按钮
    pendingGet = {
      id, btn,
      cb: (url, err) => {
        if (mySeq !== seq) return;
        if (url) { urlCache.set(id, url); finish(url); return; }
        // 后台重放失败（风控/验证码）→ 唤起官方播放器，被动截取它拿到的直链
        startExpecting(id, (u, e2) => {
          if (u) { urlCache.set(id, u); finish(u); }
          else finish(null, e2 || '未能获取直链；可先双击该文件用官方播放器播放一次，之后此按钮即可直接播放');
        });
        if (!triggerOfficial(id)) {
          stopExpecting();
          finish(null, '未找到该文件的列表条目，无法触发官方播放器');
        }
      }
    };
    window.postMessage({ source: MARKER, type: 'geturl', id }, '*');
  }

  /* ================= 官方播放器抑制与直链截取 ================= */

  let expecting = null; // { id, resolve, timer, muteTimer }
  let suppressTimer = null;
  let suppressObs = null;
  let suppressed = [];  // [el, 原opacity, 原pointerEvents]

  // 把官方播放器的外层覆盖容器压成透明+禁点击（元素仍在，请求照常，直链可截获，但用户看不到）
  function suppressOfficialOverlays() {
    suppressed.forEach(([el, o, pe]) => { try { el.style.opacity = o; el.style.pointerEvents = pe; } catch (e) { /* ignore */ } });
    suppressed = [];
    document.querySelectorAll('video').forEach((v) => {
      if (v === video || (host && host.contains(v))) return;
      let top = v;
      for (let p = v.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        if (host && p.contains(host)) break;
        top = p;
      }
      if (top && !(host && top.contains(host))) {
        suppressed.push([top, top.style.opacity, top.style.pointerEvents]);
        try {
          top.style.setProperty('opacity', '0', 'important');
          top.style.setProperty('pointer-events', 'none', 'important');
        } catch (e) { /* ignore */ }
      }
    });
  }

  function startSuppressing() {
    if (suppressTimer) return;
    suppressOfficialOverlays();
    suppressTimer = setInterval(suppressOfficialOverlays, 300);
    suppressObs = new MutationObserver(suppressOfficialOverlays);
    suppressObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function stopSuppressing() {
    if (suppressTimer) { clearInterval(suppressTimer); suppressTimer = null; }
    if (suppressObs) { try { suppressObs.disconnect(); } catch (e) { /* ignore */ } suppressObs = null; }
    suppressed.forEach(([el, o, pe]) => { try { el.style.opacity = o; el.style.pointerEvents = pe; } catch (e) { /* ignore */ } });
    suppressed = [];
  }

  function startExpecting(id, resolve) {
    stopExpecting();
    expecting = {
      id, resolve,
      timer: setTimeout(() => {
        const r = expecting && expecting.resolve;
        stopExpecting();
        if (r) r(null, '等待官方播放器返回直链超时（可能被验证码拦截）');
      }, 15000),
      // 官方播放器加载期间保持静音，避免漏出声音
      muteTimer: setInterval(() => {
        document.querySelectorAll('video').forEach((v) => {
          if (v !== video) { try { v.muted = true; } catch (e) { /* ignore */ } }
        });
      }, 300)
    };
    showToast('正在唤起官方播放器获取直链…');
  }

  function stopExpecting() {
    if (!expecting) return;
    clearTimeout(expecting.timer);
    clearInterval(expecting.muteTimer);
    expecting = null;
    document.querySelectorAll('video').forEach((v) => {
      if (v !== video) { try { v.pause(); v.muted = true; } catch (e) { /* ignore */ } }
    });
  }

  // 模拟双击文件条目，唤起官方播放器（它发出的取直链请求会被钩子截获）
  function triggerOfficial(id) {
    const el = document.querySelector('li[data-file-id="' + id + '"]') || document.querySelector('[data-file-id="' + id + '"]');
    if (!el) return false;
    const target = el.querySelector('[class*="SourceListItem__name"]') || el;
    const opts = { bubbles: true, cancelable: true, view: window };
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.dispatchEvent(new MouseEvent('click', opts));
    target.dispatchEvent(new MouseEvent('dblclick', opts));
    return true;
  }

  // 拿到直链后关掉官方播放器：暂停+静音其视频，并派发 Esc（带标记避免误关自己的播放器）
  function closeOfficialPlayer() {
    document.querySelectorAll('video').forEach((v) => {
      if (v !== video) { try { v.pause(); v.muted = true; } catch (e) { /* ignore */ } }
    });
    try {
      const ev = new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
        bubbles: true, cancelable: true, view: window
      });
      ev.__avpSynthetic = true;
      const root = document.querySelector('#__nuxt') || document.querySelector('#root')
        || document.querySelector('#app') || document.body || document.documentElement;
      root.dispatchEvent(ev);
    } catch (e) { /* ignore */ }
  }

  function closePlayer() {
    seq++;
    stopExpecting();
    stopSuppressing();
    closeOfficialPlayer(); // 若官方播放器还开着，一并关掉
    if (pendingGet) { if (pendingGet.btn) pendingGet.btn.textContent = '▶'; pendingGet = null; }
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) { /* ignore */ } }
    if (host) host.style.display = 'none';
  }
})();

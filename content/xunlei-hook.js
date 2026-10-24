/**
 * MAIN world 钩子（迅雷网盘）：
 * 1. 记录页面 API 请求头 / PLAY 请求模板（用于后台重放，可能被风控拦截）
 * 2. 被动扫描所有 API 响应体，一旦出现 vod 直链就缓存并推送给 content script
 *    —— 无论直链来自 PLAY 接口还是官方播放器的其他请求，都能截到
 * 3. 响应 content script 的 geturl 请求
 */
(() => {
  if (window.__AVP_XLP_HOOK__) return;
  window.__AVP_XLP_HOOK__ = true;

  const MARKER = '__AVP_XLP__';
  const API_RE = /api-pan\.xunlei\.com|xluser-ssl\.xunlei\.com/;
  const PLAY_RE = /api-pan\.xunlei\.com\/drive\/v1\/files\/[^?]+\?/;
  const LIST_RE = /api-pan\.xunlei\.com\/drive\/v1\/files\?/;
  const DROP_PARAMS = new Set(['usage', 'parent_id', 'filters', 'limit', 'page_token', 'thumbnail_size', 'with_audit', 'space', 'traverse']);
  const SKIP_HDRS = new Set([
    'host', 'content-length', 'origin', 'referer', 'cookie', 'connection',
    'keep-alive', 'transfer-encoding', 'upgrade', 'accept-encoding', 'user-agent'
  ]);

  const hdrsAll = {};
  const hdrsFiles = {};
  let lastPlayUrl = null;
  let lastListUrl = null;
  const urlCache = new Map(); // file_id → vod 直链

  const post = (data) => { try { window.postMessage({ source: MARKER, ...data }, '*'); } catch (e) { /* ignore */ } }

  function resolve(url) { try { return new URL(url, location.href).href; } catch (e) { return url; } }

  function record(absUrl, h) {
    if (!API_RE.test(absUrl)) return;
    h.forEach((v, k) => {
      const key = k.toLowerCase();
      if (SKIP_HDRS.has(key)) return;
      hdrsAll[key] = v;
      if (/\/drive\/v1\//.test(absUrl)) hdrsFiles[key] = v;
    });
    if (PLAY_RE.test(absUrl) && /[?&]usage=PLAY/.test(absUrl)) lastPlayUrl = absUrl;
    else if (LIST_RE.test(absUrl)) lastListUrl = absUrl;
  }

  function mergeHeaders(target, src) {
    if (!src) return;
    if (src instanceof Headers || (src && typeof src.forEach === 'function')) {
      src.forEach((v, k) => target.set(k, v));
    } else if (Array.isArray(src)) {
      src.forEach(([k, v]) => target.set(k, v));
    } else if (typeof src === 'object') {
      for (const k in src) target.set(k, src[k]);
    }
  }

  function pickUrl(j) {
    const d = (j && (j.data || j)) || {};
    if (d.download_url) return d.download_url;
    if (d.medias && d.medias[0] && d.medias[0].url) return d.medias[0].url;
    if (d.links && d.links['application/octet-stream'] && d.links['application/octet-stream'].url) {
      return d.links['application/octet-stream'].url;
    }
    return null;
  }

  function tokenFallback() {
    try { return JSON.parse(localStorage.getItem('credentials') || 'null'); } catch (e) { return null; }
  }

  function snapshot() {
    const src = Object.keys(hdrsFiles).length ? hdrsFiles : hdrsAll;
    const out = {};
    for (const k in src) out[k] = src[k];
    if (!out.authorization) {
      const c = tokenFallback();
      if (c && c.access_token) out.authorization = (c.token_type || 'Bearer') + ' ' + c.access_token;
      if (c && c.device_id && !out['x-device-id']) out['x-device-id'] = c.device_id;
    }
    return out;
  }

  /* ---- 被动扫描 API 响应体中的 vod 直链 ---- */
  function scanBody(reqUrl, txt) {
    try {
      if (!txt || txt.length > 500000) return;
      if (txt.indexOf('vod') === -1) return;
      txt = txt.replace(/\\\//g, '/').replace(/\\u0026/g, '&');
      const m = txt.match(/https?:\/\/vod[^"'\s<>]+/i);
      if (!m) return;
      const vodUrl = m[0];
      let id = null;
      const um = /drive\/v1\/files\/([^?/]+)\?/.exec(reqUrl || '');
      if (um) id = decodeURIComponent(um[1]);
      if (!id) {
        const idx = txt.indexOf(vodUrl);
        const re = /"id":"([A-Za-z0-9_\-]{10,})"/g;
        let mm;
        while ((mm = re.exec(txt))) { if (mm.index < idx) id = mm[1]; else break; }
      }
      if (id) {
        if (urlCache.get(id) !== vodUrl) { urlCache.set(id, vodUrl); post({ type: 'vod', id: id, url: vodUrl }); }
      } else if (scanBody.lastNoId !== vodUrl) {
        scanBody.lastNoId = vodUrl;
        post({ type: 'vod', id: null, url: vodUrl });
      }
    } catch (e) { /* ignore */ }
  }

  /* ---- fetch 钩子：记请求头 + 被动扫描响应 ---- */
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      let url = '';
      const h = new Headers();
      if (typeof input === 'string' || input instanceof URL) {
        url = String(input);
        if (init && init.headers) mergeHeaders(h, init.headers);
      } else if (input && typeof input === 'object') {
        url = input.url || '';
        if (input.headers) mergeHeaders(h, input.headers);
        if (init && init.headers) mergeHeaders(h, init.headers);
      }
      const abs = resolve(url);
      record(abs, h);

      const p = origFetch.apply(this, arguments);
      if (API_RE.test(abs)) {
        p.then((r) => {
          try { r.clone().text().then((t) => scanBody(abs, t)).catch(() => {}); } catch (e) { /* ignore */ }
        }).catch(() => {});
      }
      return p;
    } catch (e) {
      return origFetch.apply(this, arguments);
    }
  };

  /* ---- XHR 钩子：记请求头 + 被动扫描响应 ---- */
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetH = XMLHttpRequest.prototype.setRequestHeader;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__avpUrl = typeof url === 'string' ? url : String(url);
    this.__avpHdrs = {};
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (this.__avpHdrs) this.__avpHdrs[String(k).toLowerCase()] = v; } catch (e) { /* ignore */ }
    return origSetH.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    try {
      const abs = resolve(this.__avpUrl || '');
      if (this.__avpHdrs) {
        const h = new Headers();
        mergeHeaders(h, this.__avpHdrs);
        record(abs, h);
      }
      if (API_RE.test(abs)) {
        this.addEventListener('load', () => {
          try {
            let txt = '';
            if (this.responseType === '' || this.responseType === 'text') txt = this.responseText || '';
            else if (this.responseType === 'json') txt = JSON.stringify(this.response) || '';
            scanBody(abs, txt);
          } catch (e) { /* ignore */ }
        });
      }
    } catch (e) { /* ignore */ }
    return origSend.apply(this, arguments);
  };

  /* ---- performance 资源条目兜底找 API URL（覆盖 Worker 发出的请求） ---- */
  function perfFindUrls() {
    const out = { play: null, list: null };
    try {
      const entries = performance.getEntriesByType('resource');
      for (let i = entries.length - 1; i >= 0; i--) {
        const n = entries[i].name;
        if (!out.play && PLAY_RE.test(n) && /[?&]usage=PLAY/.test(n)) out.play = n;
        if (!out.list && LIST_RE.test(n)) out.list = n;
        if (out.play && out.list) break;
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  /* ---- 从列表请求 URL 派生 PLAY 请求 ---- */
  function deriveFromList(listUrl, id) {
    const u = new URL(listUrl);
    const keep = new URLSearchParams();
    u.searchParams.forEach((v, k) => { if (!DROP_PARAMS.has(k)) keep.set(k, v); });
    keep.set('usage', 'PLAY');
    if (!keep.has('space')) keep.set('space', '');
    return 'https://api-pan.xunlei.com/drive/v1/files/' + encodeURIComponent(id) + '?' + keep.toString();
  }

  /* ---- 响应 content script 的 geturl 请求 ---- */
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== MARKER || d.type !== 'geturl' || !d.id) return;

    if (urlCache.has(d.id)) { post({ type: 'auth', id: d.id, url: urlCache.get(d.id) }); return; }

    const snap = snapshot();
    const pf = perfFindUrls();
    const playTpl = lastPlayUrl || pf.play;
    if (playTpl) {
      const u = playTpl.replace(/(drive\/v1\/files\/)[^/?]+(?=\?|$)/, '$1' + encodeURIComponent(d.id));
      post({ type: 'auth', id: d.id, api: u, hdrs: snap });
      return;
    }
    const listUrl = lastListUrl || pf.list;
    if (listUrl) {
      try {
        post({ type: 'auth', id: d.id, api: deriveFromList(listUrl, d.id), hdrs: snap });
        return;
      } catch (e) { /* fallthrough */ }
    }
    post({ type: 'auth', id: d.id, error: '尚未捕获到迅雷 API 请求，请刷新页面后重试' });
  });
})();

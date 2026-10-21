/**
 * MAIN world 网络钩子：捕获页面发出的 .m3u8 请求地址
 * 在 document_start 时替换 XMLHttpRequest.open 与 window.fetch，
 * 将捕获到的 m3u8 URL 通过 postMessage 发给隔离世界的 content script。
 */
(() => {
  if (window.__AVP_HOOKED__) return;
  window.__AVP_HOOKED__ = true;

  const MARKER = '__AVP_M3U8__';

  const report = (url) => {
    try {
      window.postMessage({ source: MARKER, type: 'm3u8', url: String(url), at: Date.now() }, '*');
    } catch (e) { /* ignore */ }
  };

  const isM3u8 = (u) => {
    if (!u || typeof u !== 'string') return false;
    return /\.m3u8(\?|#|$)/i.test(u);
  };

  // Hook XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      if (isM3u8(url)) report(url);
      else if (url && typeof url === 'object' && isM3u8(url.url)) report(url.url);
    } catch (e) { /* ignore */ }
    return origOpen.apply(this, arguments);
  };

  // Hook fetch
  const origFetch = window.fetch;
  window.fetch = function (input) {
    try {
      let u = null;
      if (typeof input === 'string') u = input;
      else if (input && typeof input.url === 'string') u = input.url;
      if (isM3u8(u)) report(u);
    } catch (e) { /* ignore */ }
    return origFetch.apply(this, arguments);
  };

  // Hook createObjectURL 反查：Video.js VHS 可能用 blob，此处仅兜底上报 blob 标记
  // （VHS 实际通过 XHR 拉取 m3u8，上面的 open 钩子已覆盖）
})();

/**
 * 后台：按用户配置的域名列表动态注册 content scripts
 * 域名改动（storage.avpDomains）后自动重新注册，刷新页面即生效，无需重装扩展
 */

const DEFAULT_DOMAINS = ['*://*.pzbaj.cc/*'];
const PATTERN_RE = /^(\*|https?):\/\/(\*|(\*\.)?[^/*:]+)\/.*$/;

// avp-* 两个脚本：MAIN world 捕获钩子 + 隔离世界播放器（域名随用户配置）
// xlp-* 两个脚本：迅雷网盘固定注入（文件条目播放按钮 + 自带播放器），不随用户域名配置变化
const SCRIPTS = [
  { id: 'avp-hook', world: 'MAIN', js: ['content/hook.js'] },
  { id: 'avp-main', js: ['hls/hls.min.js', 'content/main.js'] },
  { id: 'xlp-hook', world: 'MAIN', js: ['content/xunlei-hook.js'], matches: ['*://*.xunlei.com/*'], allFrames: true },
  { id: 'xlp-main', js: ['content/xunlei.js'], matches: ['*://*.xunlei.com/*'], allFrames: true },
];

async function applyRegistration() {
  try {
    const { avpDomains } = await chrome.storage.local.get('avpDomains');
    // 只保留格式合法的域名，坏条目不拖垮整体注册
    const raw = Array.isArray(avpDomains) ? avpDomains : [];
    const matches = raw.filter((p) => typeof p === 'string' && PATTERN_RE.test(p));
    if (matches.length < raw.length) {
      console.warn('[AVP] 忽略无效域名:', raw.filter((p) => !matches.includes(p)));
    }
    if (!matches.length) matches.push(...DEFAULT_DOMAINS);

    // 先清掉旧注册再按新域名注册
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const ids = registered.map((s) => s.id).filter((id) => SCRIPTS.some((s) => s.id === id));
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });

    // 逐脚本注册，单个失败不影响其他脚本
    for (const base of SCRIPTS) {
      try {
        await chrome.scripting.registerContentScripts([{
          ...base,
          matches: base.matches || matches, // 未指定 matches 的脚本跟随用户域名配置
          runAt: 'document_start',
          allFrames: base.allFrames || false,
          persistAcrossSessions: true,
        }]);
      } catch (err) {
        console.error('[AVP] 注册失败:', base.id, err);
      }
    }
  } catch (e) {
    console.error('[AVP] 注册失败，检查域名格式:', e);
  }
}

chrome.runtime.onInstalled.addListener(applyRegistration);
chrome.runtime.onStartup.addListener(applyRegistration);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.avpDomains) applyRegistration();
});

/* 迅雷网盘取直链：后台执行 fetch，不受页面 CORS 限制 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'avpFetchPlayUrl' || !msg.url) return;
  (async () => {
    try {
      const r = await fetch(msg.url, {
        method: 'GET',
        headers: msg.headers || {},
        credentials: 'include'
      });
      const text = await r.text();
      if (!r.ok) { sendResponse({ error: 'HTTP ' + r.status + ': ' + text.slice(0, 200) }); return; }
      let j;
      try { j = JSON.parse(text); } catch (e) { sendResponse({ error: '响应解析失败: ' + text.slice(0, 200) }); return; }
      const d = (j && j.data) || {};
      const url = d.download_url
        || (d.medias && d.medias[0] && d.medias[0].url)
        || (d.links && d.links['application/octet-stream'] && d.links['application/octet-stream'].url);
      if (url) sendResponse({ url });
      else {
        const em = (j && typeof j.error === 'string' ? j.error : (j && j.error && j.error.message))
          || (j && j.message) || '';
        const ec = (j && (j.error_code || (j.error && j.error.error_code))) || '';
        sendResponse({ error: em ? ('接口错误: ' + em + (ec ? ' [' + ec + ']' : '')) : '未取到直链: ' + text.slice(0, 200) });
      }
    } catch (e) {
      sendResponse({ error: '请求异常: ' + e.message });
    }
  })();
  return true; // 异步 sendResponse
});

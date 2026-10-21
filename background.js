/**
 * 后台：按用户配置的域名列表动态注册 content scripts
 * 域名改动（storage.avpDomains）后自动重新注册，刷新页面即生效，无需重装扩展
 */

const DEFAULT_DOMAINS = ['*://*.pzbaj.cc/*'];

// 两个注入脚本：MAIN world 捕获钩子 + 隔离世界播放器
const SCRIPTS = [
  { id: 'avp-hook', world: 'MAIN', js: ['content/hook.js'] },
  { id: 'avp-main', js: ['hls/hls.min.js', 'content/main.js'] },
];

async function applyRegistration() {
  try {
    const { avpDomains } = await chrome.storage.local.get('avpDomains');
    const matches = Array.isArray(avpDomains) && avpDomains.length ? avpDomains : DEFAULT_DOMAINS;

    // 先清掉旧注册再按新域名注册
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const ids = registered.map((s) => s.id).filter((id) => SCRIPTS.some((s) => s.id === id));
    if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });

    for (const base of SCRIPTS) {
      await chrome.scripting.registerContentScripts([{
        ...base,
        matches,
        runAt: 'document_start',
        allFrames: false,
        persistAcrossSessions: true,
      }]);
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

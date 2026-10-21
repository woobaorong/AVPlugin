const st = document.getElementById('st');
const urlBox = document.getElementById('url');
let lastUrl = null;

chrome.storage.local.get(['avpLastUrl', 'avpLastAt'], (d) => {
  lastUrl = d.avpLastUrl || null;
  if (lastUrl) {
    st.textContent = '已捕获视频流（' + new Date(d.avpLastAt || Date.now()).toLocaleTimeString() + '）';
    st.className = 'st';
    urlBox.style.display = '';
    urlBox.textContent = lastUrl;
  } else {
    st.textContent = '尚未捕获到视频流（需在站点视频页点播放）';
    st.className = 'st bad';
  }
});

document.getElementById('open').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { cmd: 'open' }, () => void chrome.runtime.lastError);
    window.close();
  });
});

document.getElementById('copy').addEventListener('click', () => {
  if (!lastUrl) return;
  navigator.clipboard.writeText(lastUrl).then(() => {
    const b = document.getElementById('copy');
    b.textContent = '已复制';
    setTimeout(() => (b.textContent = '复制链接'), 1200);
  });
});

document.getElementById('clear').addEventListener('click', () => {
  chrome.storage.local.remove(['avpLastUrl', 'avpLastAt'], () => {
    st.textContent = '已清除记录';
    st.className = 'st bad';
    urlBox.style.display = 'none';
    lastUrl = null;
  });
});

/* ---------- 匹配域名配置 ---------- */

const DEFAULT_DOMAINS = ['*://*.pzbaj.cc/*'];
const domainsBox = document.getElementById('domains');
const domTip = document.getElementById('domTip');
const PATTERN_RE = /^(\*|https?):\/\/(\*|(\*\.)?[^/*:]+)\/.*$/;

chrome.storage.local.get('avpDomains', (d) => {
  domainsBox.value = (d.avpDomains && d.avpDomains.length ? d.avpDomains : DEFAULT_DOMAINS).join('\n');
});

function saveDomains(list) {
  chrome.storage.local.set({ avpDomains: list }, () => {
    domTip.textContent = '已保存并生效，刷新视频页即可（无需重装扩展）';
    domTip.style.color = '#8c8';
    domainsBox.value = list.join('\n');
  });
}

document.getElementById('saveDomains').addEventListener('click', () => {
  const list = domainsBox.value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!list.length) {
    domTip.textContent = '至少保留一行域名';
    domTip.style.color = '#e88';
    return;
  }
  const bad = list.find((p) => !PATTERN_RE.test(p));
  if (bad) {
    domTip.textContent = '格式无效：' + bad + '（示例 *://*.pzbaj.cc/*）';
    domTip.style.color = '#e88';
    return;
  }
  saveDomains(list);
});

document.getElementById('resetDomains').addEventListener('click', () => saveDomains([...DEFAULT_DOMAINS]));

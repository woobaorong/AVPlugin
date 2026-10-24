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

/* ---------- 匹配域名配置（数组，可添加多个） ---------- */

const DEFAULT_DOMAINS = ['*://*.pzbaj.cc/*'];
const domList = document.getElementById('domList');
const domTip = document.getElementById('domTip');
const PATTERN_RE = /^(\*|https?):\/\/(\*|(\*\.)?[^/*:]+)\/.*$/;

function addRow(value) {
  const row = document.createElement('div');
  row.className = 'domrow';
  const input = document.createElement('input');
  input.value = value || '';
  input.placeholder = '*://*.example.com/*';
  input.spellcheck = false;
  const del = document.createElement('button');
  del.className = 'del';
  del.textContent = '✕';
  del.title = '删除此域名';
  del.addEventListener('click', () => {
    row.remove();
    if (!domList.children.length) addRow(''); // 至少留一行可编辑
  });
  row.append(input, del);
  domList.appendChild(row);
}

chrome.storage.local.get('avpDomains', (d) => {
  const list = d.avpDomains && d.avpDomains.length ? d.avpDomains : DEFAULT_DOMAINS;
  list.forEach((v) => addRow(v));
  if (!list.length) addRow('');
});

document.getElementById('addDomain').addEventListener('click', () => addRow(''));

document.getElementById('saveDomains').addEventListener('click', () => {
  const list = [...domList.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
  if (!list.length) {
    domTip.textContent = '至少保留一个域名';
    domTip.style.color = '#e88';
    return;
  }
  const bad = list.find((p) => !PATTERN_RE.test(p));
  if (bad) {
    domTip.textContent = '格式无效：' + bad + '（示例 *://*.pzbaj.cc/*）';
    domTip.style.color = '#e88';
    return;
  }
  chrome.storage.local.set({ avpDomains: list }, () => {
    domTip.textContent = '已保存 ' + list.length + ' 个域名并生效，刷新视频页即可（无需重装扩展）';
    domTip.style.color = '#8c8';
  });
});

document.getElementById('resetDomains').addEventListener('click', () => {
  domList.innerHTML = '';
  DEFAULT_DOMAINS.forEach((v) => addRow(v));
  chrome.storage.local.set({ avpDomains: [...DEFAULT_DOMAINS] }, () => {
    domTip.textContent = '已恢复默认并生效';
    domTip.style.color = '#8c8';
  });
});

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

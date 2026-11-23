const DEFAULTS = { auto: false, subdir: '论文', autoVersion: 2, bridgePort: 27888, bridgeToken: '' };
async function load() {
  const cfg = await chrome.storage.local.get(DEFAULTS);
  document.getElementById('auto').checked = cfg.auto === true;
  document.getElementById('subdir').value = cfg.subdir || '论文';
  document.getElementById('bridgePort').value = cfg.bridgePort || 27888;
  document.getElementById('bridgeToken').value = cfg.bridgeToken || '';
}
document.getElementById('save').onclick = async () => {
  const auto = document.getElementById('auto').checked;
  const subdir = document.getElementById('subdir').value.trim() || '论文';
  const bridgePort = Number(document.getElementById('bridgePort').value) || 27888;
  const bridgeToken = document.getElementById('bridgeToken').value.trim();
  await chrome.storage.local.set({ auto, subdir, autoVersion: 2, bridgePort, bridgeToken });
  document.getElementById('msg').textContent = '已保存';
};
load();

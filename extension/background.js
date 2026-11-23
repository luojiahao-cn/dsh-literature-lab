const DEFAULTS = { auto: false, subdir: '论文', autoVersion: 2, bridgePort: 27888, bridgeToken: '' };
const handled = new Map();

async function settings() {
  const got = await chrome.storage.local.get(DEFAULTS);
  if (got.autoVersion !== 2) {
    await chrome.storage.local.set({ auto: false, autoVersion: 2 });
    return { ...DEFAULTS, ...got, auto: false, autoVersion: 2 };
  }
  return { ...DEFAULTS, ...got };
}

function doiOf(url) {
  const m = String(url || '').match(/10\.\d{4,9}\/[^\s"'<>]+/i);
  return m ? m[0].replace(/[.,;)]+$/, '') : '';
}

async function collect(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const links = Array.from(document.querySelectorAll('a'));
      const pdfLink = links.find((a) => /^(PDF|Download PDF)$/i.test((a.innerText || '').trim()))
        || links.find((a) => (a.href || '').toLowerCase().split('?')[0].endsWith('.pdf'));
      if (!pdfLink) return { error: 'no-pdf-link' };
      let url = pdfLink.href;
      if (/stamp\.jsp/i.test(url)) {
        const html = await fetch(url, { credentials: 'include' }).then((r) => r.text());
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const frame = doc.querySelector('iframe');
        if (!frame || !frame.src) return { error: 'no-pdf-frame' };
        url = new URL(frame.src, url).href;
      }
      const meta = (names) => {
        for (const name of names) {
          const el = document.querySelector(`meta[name="${name}"],meta[property="${name}"]`);
          if (el?.content) return el.content;
        }
        return '';
      };
      const bodyText = document.body?.innerText || '';
      const doi = meta(['citation_doi', 'dc.identifier', 'DC.identifier', 'doi'])
        || (bodyText.match(/10\.\d{4,9}\/[^\s"'<>]+/i)?.[0] || '').replace(/[.,;)]+$/, '');
      const rawTitle = meta(['citation_title', 'dc.title', 'DC.title']) || document.title || '';
      const title = rawTitle.replace(/\s*[|\-–—]\s*(IEEE Journals.*|IEEE Xplore|IEEE.*)$/i, '').trim();
      return { url, doi, title };
    },
  });
  return result || { error: 'script-empty' };
}

async function handleTab(tab) {
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) return;
  const key = `${tab.id}:${tab.url}`;
  if (handled.has(key)) return;
  handled.set(key, Date.now());
  const cfg = await settings();
  const info = await collect(tab.id);
  if (info.error) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#c0392b' });
    return;
  }
  const id = (info.doi || info.title || tab.url).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
  const base = `${cfg.subdir}/dsh-${id}`;
  const downloadId = await chrome.downloads.download({ url: info.url, filename: `${base}.pdf`, conflictAction: 'uniquify', saveAs: false });
  const [item] = await chrome.downloads.search({ id: downloadId });
  if (item?.filename) {
    try {
      const res = await fetch(`http://127.0.0.1:${cfg.bridgePort || 27888}/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.bridgeToken ? { 'x-dsh-token': cfg.bridgeToken } : {}) },
        body: JSON.stringify({ file: item.filename, doi: info.doi || '', title: info.title || '' }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || 'bridge rejected');
      await chrome.action.setBadgeText({ tabId: tab.id, text: '✓' });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#27ae60' });
    } catch (error) {
      await chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
      await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#c0392b' });
    }
  }
  const sidecar = JSON.stringify({ doi: info.doi, title: info.title, url: tab.url, at: new Date().toISOString() });
  await chrome.downloads.download({
    url: `data:application/json;charset=utf-8,${encodeURIComponent(sidecar)}`,
    filename: `${base}.json`, conflictAction: 'uniquify', saveAs: false,
  });
}

chrome.runtime.onInstalled.addListener(() => chrome.storage.local.set(DEFAULTS));
chrome.action.onClicked.addListener((tab) => handleTab(tab).catch(() => {}));
chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== 'complete' || !tab?.url) return;
  const cfg = await settings();
  if (cfg.auto !== true) return;
  if (!/ieeexplore\.ieee\.org|asmedigitalcollection\.asme\.org|onlinelibrary\.wiley\.com|sciencedirect\.com|link\.springer\.com/i.test(tab.url)) return;
  setTimeout(() => handleTab(tab).catch(() => {}), 2500);
});

/**
 * 测试公共工具：临时 baseDir、假 fetch、响应构造。
 * 所有测试都在临时目录里跑，绝不碰仓库的 state/ 与 pdfs/。
 */
import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 建一个带 config/default.json 与 state/ 的临时插件目录。 */
export async function makeBase(userConfig = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'litlab-test-'));
  await mkdir(path.join(dir, 'config'), { recursive: true });
  await mkdir(path.join(dir, 'state'), { recursive: true });
  await copyFile(path.join(REPO, 'config', 'default.json'), path.join(dir, 'config', 'default.json'));
  if (Object.keys(userConfig).length) {
    await writeFile(path.join(dir, 'state', 'config.json'), JSON.stringify(userConfig, null, 2));
  }
  return dir;
}

/** 关掉退避与限速，测试才快。 */
export function fastNetwork(overrides = {}) {
  return {
    timeoutMs: 5000,
    retries: 0,
    rssIntervalMs: 0,
    arxivIntervalMs: 0,
    arxivMaxPages: 4,
    ...overrides,
  };
}

export function textResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

export function bufferResponse(buffer, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => buffer.toString('utf8'),
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

export function statusResponse(status) {
  return {
    ok: false,
    status,
    headers: new Headers(),
    text: async () => '',
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

/**
 * 安装假 fetch。routes 里按 URL 子串匹配，返回响应或抛错。
 * @returns {Array<{url:string, headers:object}>} 调用记录
 */
export function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, headers: init.headers || {} });
    const route = routes.find((r) => href.includes(r.match));
    if (!route) throw new Error(`unexpected fetch: ${href}`);
    return route.respond(href, init, calls);
  };
  return calls;
}

/** 生成一条 arXiv Atom 条目。 */
export function arxivEntry({ id, title, published, summary = 'Abstract text.', doi = '', authors = ['A. Author'] }) {
  return `<entry>
  <id>http://arxiv.org/abs/${id}v1</id>
  <published>${published}</published>
  <updated>${published}</updated>
  <title>${title}</title>
  <summary>${summary}</summary>
  <link href="http://arxiv.org/abs/${id}v1" rel="alternate" type="text/html"/>
  <link href="http://arxiv.org/pdf/${id}v1" rel="related" title="pdf"/>
  ${doi ? `<arxiv:doi>${doi}</arxiv:doi>` : ''}
  ${authors.map((name) => `<author><name>${name}</name></author>`).join('\n  ')}
</entry>`;
}

export function arxivFeed(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title>arXiv Query Results</title>
  ${entries.join('\n')}
</feed>`;
}

/** 生成一条 RSS item。 */
export function rssItem({ title, link, description = 'Some description.', pubDate, guid = '' }) {
  return `<item>
    <title>${title}</title>
    <link>${link}</link>
    <description><![CDATA[<p>${description}</p>]]></description>
    ${guid ? `<guid>${guid}</guid>` : ''}
    ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
  </item>`;
}

export function rssFeed(items) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test feed</title>
  ${items.join('\n')}
</channel></rss>`;
}

export function isoAgo(ms) {
  return new Date(Date.now() - ms).toISOString();
}

export function rfcAgo(ms) {
  return new Date(Date.now() - ms).toUTCString();
}

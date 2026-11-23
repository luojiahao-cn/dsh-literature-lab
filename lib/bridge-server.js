/** 本机 HTTP bridge：只绑 127.0.0.1，供 Chrome 扩展在下载完成后立即推送导入。 */
import http from 'node:http';
import { readConfig } from './config.js';
import { importPdfPath } from './bridge.js';

function json(res, status, data, origin = '') {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-headers': 'content-type,x-dsh-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    vary: 'origin',
  };
  // 仅对本机 Chrome 扩展回显 origin；其他来源不回 CORS 头。token 始终是唯一鉴权。
  if (/^chrome-extension:\/\//i.test(origin)) headers['access-control-allow-origin'] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

async function bodyOf(req, max = 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error('请求过大');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function startBridgeServer(baseDir, { port = 27888, token = '' } = {}) {
  const server = http.createServer(async (req, res) => {
    const origin = String(req.headers.origin || '');
    if (req.method === 'OPTIONS') return json(res, 204, {}, origin);
    try {
      const config = await readConfig(baseDir);
      const expected = String(config?.bridge?.token || token || '');
      if (req.method === 'GET' && req.url === '/ping') return json(res, 200, { ok: true, name: 'dsh-literature-lab' }, origin);
      if (req.method !== 'POST' || req.url !== '/import') return json(res, 404, { ok: false, error: 'not found' }, origin);
      const supplied = String(req.headers['x-dsh-token'] || '');
      // 不接受“Chrome 扩展 Origin 免 token”：本机任意进程都能伪造该头。
      if (!expected || supplied !== expected) {
        return json(res, 401, { ok: false, error: '需要有效的 x-dsh-token' }, origin);
      }
      const body = JSON.parse(await bodyOf(req) || '{}');
      const result = await importPdfPath(baseDir, config, {
        file: body.file, doi: body.doi || '', title: body.title || '',
      });
      return json(res, result.ok ? 200 : 400, result);
    } catch (error) {
      return json(res, 500, { ok: false, error: String(error?.message || error) });
    }
  });
  server.on('error', () => {});
  const listenPort = Number.isFinite(Number(port)) ? Number(port) : 27888;
  server.listen(listenPort, '127.0.0.1');
  server.unref?.();
  return server;
}

/**
 * 本地模拟 CloudBase HTTP 网关，用来在没部署前验证云函数。
 *
 *   node test-local.mjs            # 默认 8787 端口
 *   PORT=9000 node test-local.mjs
 *
 * 会读取同目录的 .env.local（MAAS_API_KEY=... 之类），没有就只用进程环境变量。
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// .env.local（可选的本地配置，别提交）
try {
  const txt = await readFile(path.join(here, '.env.local'), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* 没有就算了 */ }

const fn = require('./functions/rp/index.js');
const PORT = Number(process.env.PORT || 8787);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks).toString('utf8');

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(',') : v;

  const event = {
    path: url.pathname,
    httpMethod: req.method,
    headers,
    queryStringParameters: Object.fromEntries(url.searchParams),
    body,
    isBase64Encoded: false,
  };

  try {
    const out = await fn.main(event);
    res.writeHead(out.statusCode || 200, out.headers || {});
    res.end(out.isBase64Encoded ? Buffer.from(out.body || '', 'base64') : out.body || '');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('harness error: ' + (e && e.stack ? e.stack : String(e)));
  }
});

server.listen(PORT, () => {
  console.log('[test-local] http://127.0.0.1:' + PORT);
  console.log('[test-local] hasKey=' + !!process.env.MAAS_API_KEY + '  hasCode=' + !!process.env.ACCESS_CODE);
});
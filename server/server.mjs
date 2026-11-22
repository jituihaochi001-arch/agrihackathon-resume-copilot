/* server.mjs — 零依赖本地代理 + 静态托管
 *
 * 为什么需要它：MaaS 网关对浏览器的 CORS 预检（OPTIONS）不放行，
 * 纯前端直连会被浏览器拦下。这里做同源代理：
 *   - 前端页面与本服务同源 → 无预检 → 请求畅通
 *   - API Key 只留在服务端 config.json → 不进浏览器、不上 GitHub
 *
 * 路由：
 *   GET  /                 静态文件（resume-polish 目录）
 *   GET  /api/health       { ok, hasKey, model, baseURL }
 *   GET  /api/config       前端可读的公开配置（不含 Key）
 *   POST /api/config       保存设置（baseURL / apiKey / model / temperature / stream / maxTokens）
 *   GET  /api/models       透传上游模型列表（缓存 5 分钟）
 *   POST /api/chat         透传 /chat/completions，支持 SSE 流式
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 本目录 (server/)
const APP = path.resolve(ROOT, '..');                        // resume-polish/
const CONFIG_PATH = path.join(ROOT, 'config.json');
const PORT_FILE = path.join(ROOT, 'port.json');

const DEFAULTS = {
  baseURL: 'https://maas-api.antdigital.com/v1',
  apiKey: '',
  model: 'ling-3.1-flash',
  temperature: 0.7,
  stream: true,
  maxTokens: 4096,
  port: 8765,
};

function loadCfg() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return { ...DEFAULTS }; }
}
function saveCfg(c) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2)); }

let cfg = loadCfg();

/* ---------------- 静态文件 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(APP, rel));
  if (!file.startsWith(APP)) { res.writeHead(403); return res.end('forbidden'); }

  // 只托管前端资源：挡住 server/ 目录、点文件和后端/配置文件，避免 Key 被下载
  const relPath = '/' + path.relative(APP, file).split(path.sep).join('/');
  const base = path.basename(file);
  const ext = path.extname(file).toLowerCase();
  const DENY_DIRS = /^\/(server|tools|node_modules)(\/|$)/i;
  const DENY_EXT = new Set(['.json', '.log', '.mjs', '.bat', '.cmd', '.ps1', '.md', '.bak', '.env', '.yml', '.yaml', '.toml']);
  if (DENY_DIRS.test(relPath) || base.startsWith('.') || DENY_EXT.has(ext)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }

  fs.readFile(file, (err, buf) => {
    if (err) { try { res.writeHead(404); res.end('not found: ' + rel); } catch {} return; }
    try {
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(buf);
    } catch {}
  });
}

/* ---------------- 上游转发 ---------------- */

function upstreamHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + cfg.apiKey,
  };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  if (res.headersSent) { try { res.end(); } catch {} return; }   // 流已开始就不再写头
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 30 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

/* 访客自带的 Key：前端通过请求头传，优先级高于 server/config.json */
function llmFromHeaders(req) {
  const base = (req.headers['x-llm-base'] || '').toString().trim();
  const key = (req.headers['x-llm-key'] || '').toString().trim();
  const model = (req.headers['x-llm-model'] || '').toString().trim();
  if (!base || !key) return null;
  let u;
  try { u = new URL(base); } catch { return { error: '接口地址不合法' }; }
  if (!/^https?:$/.test(u.protocol)) return { error: '接口地址必须是 http(s)' };
  if (!/^https?:/.test(base) || base.length > 300) return { error: '接口地址不合法' };
  return { baseURL: base.replace(/\/+$/, ''), apiKey: key, model };
}

let modelsCache = { at: 0, data: null };

async function handleModels(req, res) {
  const llm = llmFromHeaders(req);
  if (llm && llm.error) return sendJson(res, 400, { error: llm.error });

  const now = Date.now();
  if (!llm && modelsCache.data && now - modelsCache.at < 5 * 60 * 1000) {
    return sendJson(res, 200, modelsCache.data);
  }
  try {
    const src = llm || { baseURL: cfg.baseURL.replace(/\/$/, ''), apiKey: cfg.apiKey };
    const r = await fetch(src.baseURL.replace(/\/$/, '') + '/models', {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + src.apiKey },
    });
    const text = await r.text();
    if (!r.ok) return sendJson(res, r.status, { error: '上游返回 ' + r.status + '：' + text.slice(0, 200) });
    const data = JSON.parse(text);
    if (!llm) modelsCache = { at: now, data };
    sendJson(res, 200, data);
  } catch (e) {
    sendJson(res, 502, { error: '无法连接上游：' + e.message });
  }
}

async function handleChat(req, res) {
  let body;
  try { body = await readBody(req); }
  catch (e) { return sendJson(res, 400, { error: e.message }); }

  const llm = llmFromHeaders(req);
  if (llm && llm.error) return sendJson(res, 400, { error: llm.error });

  const src = llm ? { baseURL: llm.baseURL, apiKey: llm.apiKey } : { baseURL: cfg.baseURL, apiKey: cfg.apiKey };
  if (!src.apiKey) {
    return sendJson(res, 500, { error: '没有可用的 Key：请在「AI 设置」里选一家服务商填自己的 Key，或填 server/config.json' });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || !messages.length) {
    return sendJson(res, 400, { error: '缺少 messages' });
  }

  const payload = {
    model: (llm && llm.model) || body.model || cfg.model,
    messages,
    temperature: body.temperature != null ? body.temperature : cfg.temperature,
    max_tokens: body.max_tokens || body.maxTokens || cfg.maxTokens || 4096,
    stream: !!body.stream,
  };

  const upstreamUrl = src.baseURL.replace(/\/$/, '') + '/chat/completions';
  let up;
  try {
    up = await fetch(upstreamUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + src.apiKey },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return sendJson(res, 502, { error: '连接上游失败：' + e.message + '（请检查 baseURL 与网络）' });
  }

  if (!up.ok) {
    const text = await up.text();
    return sendJson(res, up.status, { error: '上游 ' + up.status + '：' + text.slice(0, 300) });
  }

  if (payload.stream) {
    // SSE 原样转发；客户端中途断开属于正常情况，不能让它把服务打崩
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    // fetch 的 body 是 Web ReadableStream，没有 Node 的 pipe()，逐块手动写
    const reader = up.body.getReader();
    let closed = false;
    const stop = () => { closed = true; try { reader.cancel(); } catch {} };
    res.on('close', stop);
    req.on('close', stop);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || closed) break;
        if (value && value.length) {
          if (!res.write(value)) await new Promise((r) => res.once('drain', r));
        }
      }
    } catch (e) { /* 客户端断开等 */ }
    if (!res.writableEnded) { try { res.end(); } catch {} }
    return;
  }

  const text = await up.text();
  if (res.headersSent || res.writableEnded) return;
  try {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(text);
  } catch (e) { try { res.end(); } catch {} }
}

/* ---------------- 路由 ---------------- */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  // 客户端随时可能断开（长请求尤其常见），必须接住 socket 错误，否则会打崩进程
  res.on('error', () => {});
  req.on('error', () => {});

  // CORS：即使 page 是 file:// 打开（origin 为 null）也能调本代理
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    if (p === '/api/health') {
      return sendJson(res, 200, {
        ok: true, hasKey: !!cfg.apiKey, model: cfg.model,
        baseURL: cfg.baseURL, stream: cfg.stream, temperature: cfg.temperature,
      });
    }
    if (p === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, {
        baseURL: cfg.baseURL, model: cfg.model, temperature: cfg.temperature,
        stream: cfg.stream, maxTokens: cfg.maxTokens, hasKey: !!cfg.apiKey,
      });
    }
    if (p === '/api/config' && req.method === 'POST') {
      const b = await readBody(req);
      cfg = {
        ...cfg,
        baseURL: String(b.baseURL || cfg.baseURL).trim(),
        apiKey: (typeof b.apiKey === 'string' && b.apiKey.trim()) ? b.apiKey.trim() : cfg.apiKey,
        model: String(b.model || cfg.model).trim(),
        temperature: Math.min(1, Math.max(0, Number(b.temperature ?? cfg.temperature) || 0.7)),
        stream: b.stream !== undefined ? !!b.stream : cfg.stream,
        maxTokens: Math.min(32000, Math.max(256, Number(b.maxTokens || cfg.maxTokens) || 4096)),
      };
      saveCfg(cfg);
      return sendJson(res, 200, { ok: true, hasKey: !!cfg.apiKey, model: cfg.model, baseURL: cfg.baseURL });
    }
    if (p === '/api/models' && req.method === 'GET') return await handleModels(req, res);
    if (p === '/api/chat' && req.method === 'POST') return await handleChat(req, res);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    return serveStatic(req, res, p);
  } catch (e) {
    if (!res.headersSent) return sendJson(res, 500, { error: String((e && e.message) || e) });
    try { res.end(); } catch {}
  }
});

// 长请求 + 客户端断开的组合下，兜底不让单次异常带走整个服务
server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
});
process.on('uncaughtException', (e) => {
  console.error('[uncaught]', (e && e.stack) || e);
});
process.on('unhandledRejection', (e) => {
  console.error('[unhandled]', (e && e.stack) || e);
});

/* ---------------- 启动 ---------------- */

function openBrowser(url) {
  try {
    const cp = process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    exec(cp + ' "' + url + '"');
  } catch {}
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const s = server.once('error', reject).listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(port);
    });
  });
}

async function main() {
  const want = cfg.port || DEFAULTS.port;
  let port = want;
  for (;;) {
    try { port = await listen(port); break; }
    catch (e) {
      if (port > want + 20) { console.error('端口都被占用，启动失败'); process.exit(1); }
      port++;
    }
  }
  fs.writeFileSync(PORT_FILE, JSON.stringify({ port, at: Date.now() }));
  const url = 'http://127.0.0.1:' + port + '/';
  console.log('----------------------------------------------');
  console.log('  简历精修 + 模拟面试 已在本地启动');
  console.log('  打开：' + url);
  console.log('  模型：' + cfg.model + ' · ' + (cfg.apiKey ? 'Key 已配置' : '⚠ 未配置 Key'));
  console.log('  按 Ctrl+C 停止');
  console.log('----------------------------------------------');
  openBrowser(url);
}

main();

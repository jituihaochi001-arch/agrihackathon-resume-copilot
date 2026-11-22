/**
 * 简历精修 · 腾讯云 CloudBase 云函数（HTTP 网关）
 *
 * 一个函数干两件事：
 *   1) /api/config | /api/chat | /api/models | /api/health —— 转发访客自带的大模型接口（BYOK）
 *   2) 其余路径 —— 直接返回 public/ 里的前端文件（同源，无 CORS、无 Cookie 问题）
 *
 * 站点不内置大模型 Key：/api/config 的 hasKey 恒为 false，
 * 必须在「API 设置」里填入自己的 Key（请求头 x-llm-base / x-llm-key / x-llm-model）。
 *
 * 环境变量：
 *   TEMPERATURE     选填，默认 0.7
 *   MAX_TOKENS      选填，默认 4096
 *   ACCESS_CODE     选填，填了就要求访问码（?code= / x-access-code / Cookie）
 *   RP_SERVE_STATIC 选填，'0' 关闭静态托管（只做 API 用）
 *   RP_GZIP         选填，'1' 开启 gzip（文本资源，省流量；先用默认关闭确认能跑通）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PUBLIC_DIR = path.join(__dirname, 'public');

const CFG = {
  temperature: Number(process.env.TEMPERATURE || 0.7),
  maxTokens: Number(process.env.MAX_TOKENS || 4096),
  accessCode: process.env.ACCESS_CODE || '',
  serveStatic: String(process.env.RP_SERVE_STATIC || '1') !== '0',
  gzip: String(process.env.RP_GZIP || '0') === '1',
  upstreamMs: Number(process.env.UPSTREAM_TIMEOUT_MS || 55000),
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-access-code,x-llm-base,x-llm-key,x-llm-model',
  'access-control-max-age': '86400',
  // 云开发 HTTP 网关默认给所有响应加 content-disposition: attachment，
  // 会让浏览器把 index.html 当附件下载；显式声明 inline 覆盖它。
  'content-disposition': 'inline',
};

const API_NAMES = ['health', 'config', 'chat', 'models'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.map': 'application/json; charset=utf-8',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

/** 文本类可以直接当字符串返回；其余走 base64 */
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.txt', '.svg', '.map']);

// 进程内缓存：云函数实例复用，文件不会变（发布即换实例）
const fileCache = new Map(); // absPath -> { body, b64, mtimeMs, size, type }

/** 统一入口：HTTP 网关 event -> 标准响应 */
exports.main = async function (event) {
  try {
    return await route(normalize(event));
  } catch (e) {
    return sendJson({ error: '函数内部错误：' + (e && e.message ? e.message : String(e)) }, 500);
  }
};

// 有些控制台默认 handler 名是 index.main
exports.handler = exports.main;

function normalize(event) {
  event = event || {};
  const headers = {};
  const raw = event.headers || {};
  for (const k of Object.keys(raw)) {
    if (raw[k] != null) headers[String(k).toLowerCase()] = String(raw[k]);
  }

  const ctx = event.requestContext || {};
  let p = event.path || event.rawPath || ctx.httpPath || ctx.path || '/';
  let method = event.httpMethod || (ctx.http && ctx.http.method) || ctx.httpMethod || 'GET';

  // 访问码也可以直接写在路径里（/7a8d66c4.../），先剥掉，
  // 这样带尾斜杠的地址（.../code/）也能正确取到同目录下的 css/js。
  if (CFG.accessCode) {
    const cp = '/' + CFG.accessCode;
    if (p === cp || p === cp + '/') p = '/';
    else if (p.indexOf(cp + '/') === 0) p = p.slice(cp.length);
  }

  // HTTP 网关可能带 /api、/函数名 之类前缀，也可能已剥掉
  const prefixes = ['/api', '/' + (process.env.SCF_FUNCTIONNAME || 'rp')];
  let bare = p;
  for (const pre of prefixes) {
    if (bare === pre) { bare = '/'; break; }
    if (bare.indexOf(pre + '/') === 0) { bare = bare.slice(pre.length); break; }
  }
  // 形如 /chat、/config 的请求（前缀被网关剥掉）也按 API 处理
  const seg = bare.replace(/^\/+/, '');
  const isBareApi = API_NAMES.indexOf(seg) >= 0 && p.indexOf('/api/') !== 0;

  let body = event.body || '';
  if (event.isBase64Encoded && body) {
    body = Buffer.from(body, 'base64').toString('utf8');
  } else if (body && typeof body === 'object') {
    body = JSON.stringify(body);
  }

  return {
    path: bare,           // 已去掉 /api、访问码之类前缀
    fullPath: p,
    method: String(method).toUpperCase(),
    headers,
    body,
    query: event.queryStringParameters || {},
    isBareApi,
  };
}

async function route(req) {
  if (req.method === 'OPTIONS') {
    return { statusCode: 204, headers: Object.assign({}, CORS, { 'cache-control': 'no-store' }), body: '' };
  }

  const p = req.path === '/' ? '/' : req.path.replace(/\/+$/, '');
  const apiPath = req.fullPath.indexOf('/api/') === 0 || req.isBareApi
    ? '/api/' + req.path.replace(/^\/+/, '')
    : '';

  if (apiPath) return handleApi(req, apiPath);

  if (!CFG.serveStatic) {
    return sendJson({ error: 'not found（未开启静态托管）' }, 404);
  }
  return serveStatic(p);
}

/* ------------------------------ API ------------------------------ */

async function handleApi(req, apiPath) {
  if (apiPath === '/api/health') {
    return sendJson({ ok: true, hasKey: false, hosted: true, runtime: 'cloudbase' });
  }

  if (apiPath === '/api/config') {
    if (req.method !== 'GET') {
      return sendJson({ error: '线上版配置由站点统一管理，不能在前端修改' }, 405);
    }
    // 站点不内置大模型 Key：hasKey 恒为 false，由访客在「API 设置」里填自己的
    return sendJson({
      ok: true,
      hasKey: false,
      temperature: CFG.temperature,
      stream: false, // 云函数一次性返回，不支持 SSE 流式
      maxTokens: CFG.maxTokens,
      hosted: true,
      byok: true,
    });
  }

  // 访客自带 Key（只在该请求里使用，不落盘）
  const llm = llmFromHeaders(req.headers);
  if (llm && llm.error) return sendJson({ error: llm.error }, 400);

  // 没带 Key 时必须过访问码；带了自己的 Key 时，只放行已知服务商
  if (!authorized(req)) {
    if (!llm) return sendJson({ error: '需要访问码：请使用带 ?code= 的链接打开本站' }, 403);
    if (!allowedHost(llm.baseURL)) {
      return sendJson({ error: '该接口地址需要访问码才能使用；请改用列表里的服务商，或用带 ?code= 的链接打开本站' }, 403);
    }
  }

  if (apiPath === '/api/chat') return proxyChat(req, llm);
  if (apiPath === '/api/models') return proxyModels(llm);

  return sendJson({ error: 'not found' }, 404);
}

function authorized(req) {
  if (!CFG.accessCode) return true;
  const h = req.headers['x-access-code'];
  if (h && h === CFG.accessCode) return true;
  if (req.query && req.query.code && req.query.code === CFG.accessCode) return true;
  const m = /(?:^|;\s*)rp_code=([^;]+)/.exec(req.headers.cookie || '');
  if (m) {
    try { if (decodeURIComponent(m[1]) === CFG.accessCode) return true; } catch (e) { /* 忽略坏 Cookie */ }
  }
  return false;
}

/** 从请求头取访客自带的接口（x-llm-base / x-llm-key / x-llm-model） */
function llmFromHeaders(headers) {
  const base = (headers['x-llm-base'] || '').trim();
  const key = (headers['x-llm-key'] || '').trim();
  const model = (headers['x-llm-model'] || '').trim();
  if (!base || !key) return null;
  if (base.length > 300) return { error: '接口地址过长' };

  let u;
  try { u = new URL(base); } catch (e) { return { error: '接口地址不合法' }; }
  if (u.protocol !== 'https:') return { error: '线上版只允许 https 接口地址' };
  if (u.username || u.password) return { error: '接口地址不能带账号密码' };
  if (u.port && u.port !== '443') return { error: '线上版只允许 443 端口' };
  if (isPrivateHost(u.hostname)) return { error: '接口地址不能指向内网' };
  if (!/^[\x21-\x7e]+$/.test(base)) return { error: '接口地址含非法字符' };
  return { baseURL: base.replace(/\/+$/, ''), apiKey: key, model };
}

function isPrivateHost(h) {
  const host = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^(10|127)\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (host === '0.0.0.0' || host === '::1' || host === '::') return true;
  if (/^(f[cd][0-9a-f]{2}):/i.test(host) && host.indexOf(':') >= 0) return true;
  return false;
}

/** 无访问码时只放行这些常用服务商（避免被当成任意代理） */
const ALLOWED_HOSTS = [
  'api.openai.com', 'api.deepseek.com', 'api.moonshot.cn', 'open.bigmodel.cn',
  'api.siliconflow.cn', 'openrouter.ai', 'api.anthropic.com', 'api.groq.com',
  'api.mistral.ai', 'api.together.xyz', 'api.x.ai', 'api.perplexity.ai',
  'dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'ark.cn-beijing.volces.com',
  'generativelanguage.googleapis.com', 'maas-api.antdigital.com', 'api.minimaxi.com',
  'qianfan.baidubce.com', 'api.stepfun.com', 'api.lingyiwanwu.com', 'api.novita.ai',
];

function allowedHost(base) {
  try {
    const host = new URL(base).hostname.toLowerCase();
    return ALLOWED_HOSTS.some(function (h) { return host === h || host.endsWith('.' + h); });
  } catch (e) {
    return false;
  }
}

async function proxyChat(req, llm) {
  if (req.method !== 'POST') return sendJson({ error: 'method not allowed' }, 405);

  const src = llm;
  if (!src) return sendJson({ error: '还没有连接大模型：请到「API 设置」选择服务商并填入自己的 Key' }, 503);

  if (req.body && req.body.length > 2 * 1024 * 1024) return sendJson({ error: '请求体过大' }, 413);

  let body;
  try {
    body = JSON.parse(req.body || '');
  } catch (e) {
    return sendJson({ error: '请求不是合法 JSON' }, 400);
  }
  if (!body || !Array.isArray(body.messages)) return sendJson({ error: 'messages 必填' }, 400);

  // 云函数不支持流式返回：无论前端怎么说，都按一次性返回请求上游
  const payload = Object.assign({}, body, {
    model: (llm && llm.model) || body.model || '',
    stream: false,
  });
  delete payload.apiKey;

  const r = await fetchAbort(String(src.baseURL).replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + src.apiKey },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  if (!r.ok) return jsonText(text, r.status);
  return jsonText(text, 200);
}

async function proxyModels(llm) {
  const src = llm;
  if (!src) return sendJson({ error: '还没有连接大模型：请到「API 设置」填入自己的 Key' }, 503);

  const r = await fetchAbort(String(src.baseURL).replace(/\/+$/, '') + '/models', {
    headers: { authorization: 'Bearer ' + src.apiKey },
  });
  const text = await r.text();
  return jsonText(text, r.status);
}

async function fetchAbort(url, init) {
  const ctl = new AbortController();
  const timer = setTimeout(function () { ctl.abort(); }, CFG.upstreamMs);
  try {
    return await fetch(url, Object.assign({}, init, { signal: ctl.signal }));
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------- 静态资源 --------------------------- */

function serveStatic(p) {
  let rel = p === '/' ? '/index.html' : p;
  try { rel = decodeURIComponent(rel); } catch (e) { return notFound(); }

  if (rel.indexOf('\u0000') >= 0 || rel.split('/').indexOf('..') >= 0) return notFound();

  const abs = path.join(PUBLIC_DIR, path.normalize(rel));
  if (abs.indexOf(PUBLIC_DIR) !== 0) return notFound();

  let st = statSafe(abs);
  if (!st || !st.isFile()) {
    if (path.extname(rel)) return notFound();
    // 单页应用：没有扩展名的路径一律回首页
    const home = path.join(PUBLIC_DIR, 'index.html');
    st = statSafe(home);
    if (!st) return notFound();
    return sendFile(home, st, '/index.html');
  }
  return sendFile(abs, st, rel);
}

function statSafe(p) {
  try { return fs.statSync(p); } catch (e) { return null; }
}

function sendFile(abs, st, rel) {
  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';

  let cached = fileCache.get(abs);
  if (!cached || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size) {
    const buf = fs.readFileSync(abs);
    const isText = TEXT_EXT.has(ext);
    let body = isText ? buf.toString('utf8') : buf.toString('base64');
    let b64 = !isText;

    if (CFG.gzip && isText && buf.length > 2048) {
      body = zlib.gzipSync(buf).toString('base64');
      b64 = true;
    }
    cached = { body: body, b64: b64, mtimeMs: st.mtimeMs, size: st.size, type: type };
    fileCache.set(abs, cached);
  }

  const noCache = ext === '.html' || ext === '.js' || ext === '.css' || ext === '.json';
  const headers = Object.assign({}, CORS, {
    'content-type': type,
    etag: etag,
    'last-modified': new Date(st.mtimeMs).toUTCString(),
    // 入口和代码每次校验（304 很便宜），避免更新后浏览器还拿旧 JS/CSS
    'cache-control': noCache ? 'no-cache' : 'public, max-age=604800',
    'x-content-type-options': 'nosniff',
  });
  if (CFG.gzip && cached.b64 && TEXT_EXT.has(ext)) headers['content-encoding'] = 'gzip';

  return { statusCode: 200, headers: headers, body: cached.body, isBase64Encoded: cached.b64 };
}

function notFound() {
  return {
    statusCode: 404,
    headers: Object.assign({}, CORS, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }),
    body: '404 Not Found',
  };
}

/* ---------------------------- 响应工具 ---------------------------- */

function sendJson(obj, status) {
  return {
    statusCode: status || 200,
    headers: Object.assign({}, CORS, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    }),
    body: JSON.stringify(obj),
  };
}

/** 原样转发上游 JSON（保留上游状态码与错误体） */
function jsonText(text, status) {
  return {
    statusCode: status || 200,
    headers: Object.assign({}, CORS, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    }),
    body: text,
  };
}

module.exports.CFG = CFG;
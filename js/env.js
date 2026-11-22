/* env.js — 运行环境：接口基地址 + 访问码
 * 本机 / Cloudflare Worker：同源，RP_API_BASE 留空即可。
 * 腾讯云 CloudBase：若前端与云函数不同域名，构建时把地址写进 RP_API_BASE。
 * 访问码：?code=xxx 会存进本浏览器，之后以 x-access-code 头发给后端（服务端也可自行换 Cookie）。
 */
(function () {
  'use strict';

  var CODE_KEY = 'rp.code';

  function readStore(k) {
    try { return localStorage.getItem(k) || ''; } catch (e) { return ''; }
  }
  function writeStore(k, v) {
    try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { /* 隐私模式 */ }
  }

  // ?code=xxx：存起来，并从地址栏抹掉，避免被随手转发/留在历史里
  try {
    var q = new URLSearchParams(location.search);
    var c = q.get('code');
    if (c && c.trim()) {
      writeStore(CODE_KEY, c.trim());
      q.delete('code');
      var rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + (location.hash || ''));
    }
  } catch (e) { /* file:// 或老浏览器：忽略 */ }

  // /<code>：路径式访问码。腾讯云 CloudBase 默认域名会插入“访问提示”中间页，
  // 它只保留路径、会丢掉 ?query，所以分享链接用 /访问码 更稳。
  try {
    var m = /^\/([A-Za-z0-9_-]{8,64})\/?$/.exec(location.pathname);
    if (m && m[1].indexOf('.') === -1) {
      writeStore(CODE_KEY, m[1]);
      history.replaceState(null, '', '/' + (location.search || '') + (location.hash || ''));
    }
  } catch (e) { /* 忽略 */ }

  function code() { return readStore(CODE_KEY); }

  function apiBase() {
    var b = (typeof window.RP_API_BASE === 'string' && window.RP_API_BASE) || '';
    return b.replace(/\/+$/, '');
  }

  window.RP = {
    apiBase: apiBase,
    code: code,
    setCode: function (v) { writeStore(CODE_KEY, (v || '').trim()); },
    clearCode: function () { writeStore(CODE_KEY, ''); }
  };
})();
/* ai.js — 大模型客户端：统一走同源代理（无 CORS）；线上版支持访客自带 Key */
(function () {
  'use strict';

  var cfg = { baseURL: '', model: '', temperature: 0.7, stream: true, serverStream: true, maxTokens: 4096, hasKey: false, hosted: false, own: false };
  var loaded = false;
  var codeAsked = false;

  /** 接口基地址：本机 / Worker 同源时为空；前端与云函数不同域名时由 env.js 指定 */
  function api(p) {
    var b = (window.RP && window.RP.apiBase) ? window.RP.apiBase() : '';
    return b + p;
  }
  /** 访问码（?code= 存下来的），后端用作 x-access-code */
  function codeHeader() {
    var c = (window.RP && window.RP.code) ? window.RP.code() : '';
    return c ? { 'x-access-code': c } : {};
  }

  // 访客自带 Key：按服务商分别存在本浏览器；请求经同源代理转发，服务端不落盘
  var STORE = 'rp.llm.v2';
  var own = null;
  var modelLists = {};

  /** 服务商预设：全部走 OpenAI 兼容接口，base 指向 /chat/completions 的上一级 */
  var PROVIDERS = [
    { id: 'deepseek', name: 'DeepSeek', mark: 'DS', base: 'https://api.deepseek.com/v1',
      link: 'https://platform.deepseek.com/api_keys', note: 'deepseek-chat / deepseek-reasoner' },
    { id: 'qwen', name: '通义千问', mark: 'QW', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      link: 'https://bailian.console.aliyun.com/', note: 'qwen-max / qwen-plus / qwen-turbo' },
    { id: 'doubao', name: '豆包', mark: '豆', base: 'https://ark.cn-beijing.volces.com/api/v3',
      link: 'https://console.volcengine.com/ark', note: '模型名填「接入点 ID」（ep-xxx）' },
    { id: 'kimi', name: 'Kimi', mark: 'KM', base: 'https://api.moonshot.cn/v1',
      link: 'https://platform.moonshot.cn/console/api-keys', note: 'moonshot-v1-8k / 32k' },
    { id: 'glm', name: '智谱 GLM', mark: 'GLM', base: 'https://open.bigmodel.cn/api/paas/v4',
      link: 'https://bigmodel.cn/usercenter/apikeys', note: 'glm-4-plus / glm-4-flash' },
    { id: 'siliconflow', name: '硅基流动', mark: 'SF', base: 'https://api.siliconflow.cn/v1',
      link: 'https://cloud.siliconflow.cn/account/ak', note: '聚合多家开源模型' },
    { id: 'openrouter', name: 'OpenRouter', mark: 'OR', base: 'https://openrouter.ai/api/v1',
      link: 'https://openrouter.ai/keys', note: '一个 Key 调多家模型' },
    { id: 'openai', name: 'OpenAI', mark: 'AI', base: 'https://api.openai.com/v1',
      link: 'https://platform.openai.com/api-keys', note: 'gpt-4o / gpt-4o-mini' },
    { id: 'gemini', name: 'Gemini', mark: 'GM', base: 'https://generativelanguage.googleapis.com/v1beta/openai',
      link: 'https://aistudio.google.com/apikey', note: 'Google 的 OpenAI 兼容端点' },
    { id: 'custom', name: '自定义 / 中转', mark: '自', base: '',
      link: '', note: '填任何 OpenAI 兼容地址（必须 https）' },
  ];

  function provById(id) {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
    return PROVIDERS[0];
  }

  /** 服务商留空模型名时的常用默认值（不填也能直接连通） */
  var DEFAULT_MODELS = {
    deepseek: 'deepseek-chat',
    qwen: 'qwen-plus',
    doubao: '',
    kimi: 'moonshot-v1-8k',
    glm: 'glm-4-flash',
    siliconflow: 'Qwen/Qwen2.5-7B-Instruct',
    openrouter: '',
    openai: 'gpt-4o-mini',
    gemini: 'gemini-2.0-flash',
    custom: '',
  };
  function ownLoad() {
    try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; }
  }
  function ownSave(o) {
    own = o;
    try { localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) { /* 隐私模式 */ }
  }
  function curId() {
    var id = (own && own.provider) || PROVIDERS[0].id;
    // 老版本存过「站点内置」，现在已取消该选项，回落到第一个真实服务商
    return provById(id).id;
  }
  function curProv() { return provById(curId()); }
  function pKey(id) { return (own && own.keys && own.keys[id]) || ''; }
  function pBase(id) { return (own && own.bases && own.bases[id]) || provById(id).base || ''; }
  function pModel(id) { return (own && own.models && own.models[id]) || ''; }

  /** 当前真正要用的外部接口；返回 null 表示用户还没配置，AI 功能不可用 */
  function activeLlm() {
    var p = curProv();
    if (!p) return null;
    var key = pKey(p.id), base = pBase(p.id);
    if (!key || !base) return null;
    return { id: p.id, base: base, key: key, model: pModel(p.id) || DEFAULT_MODELS[p.id] || '' };
  }

  /** 自带 Key 时附加的请求头；否则返回空对象 */
  function llmHeaders() {
    var a = activeLlm();
    if (!a) return {};
    return { 'x-llm-base': a.base, 'x-llm-key': a.key, 'x-llm-model': a.model || '' };
  }

  /** 把浏览器里的偏好应用到当前运行配置 */
  function applyPrefs() {
    if (!own) return;
    if (own.temperature != null) cfg.temperature = own.temperature;
    if (own.maxTokens) cfg.maxTokens = own.maxTokens;
    if (own.stream != null) cfg.stream = !!own.stream && cfg.serverStream !== false;
    var a = activeLlm();
    if (a) {
      cfg.own = true;
      cfg.hasKey = true;
      if (a.model) cfg.model = a.model;
    } else {
      cfg.own = false;
      cfg.hasKey = false;   // 站点不再内置 Key：未配置就是未连接
    }
  }

  /** 未配置大模型时的统一错误，界面据此提示去「API 设置」 */
  function notConnected() {
    var e = new Error('还没有连接大模型：请到「API 设置」选择服务商并填入自己的 Key；不配置时仍可用规则版优化');
    e.code = 'NO_LLM';
    return e;
  }

  // 线上版用 ?code= 换 Cookie / 存本地；本机版不会有 403
  function askCode() {
    if (codeAsked) return;
    codeAsked = true;
    var c = window.prompt('请输入访问码（管理员提供）');
    if (!c || !c.trim()) return;
    if (window.RP && window.RP.setCode) window.RP.setCode(c.trim());
    location.reload();
  }

  /** 上游错误体里的 error 可能是字符串、也可能是 { message, type } */
  function errText(j) {
    if (!j || !j.error) return '';
    var e = j.error;
    if (typeof e === 'string') return e;
    return e.message || e.type || (function () {
      try { return JSON.stringify(e); } catch (x) { return '未知错误'; }
    })().slice(0, 180);
  }

  /** 把上游常见的英文报错翻成中文，避免「测试连接」里出现一整屏英文 */
  function zhUpstream(status, raw) {
    var s = String(raw || '');
    var low = s.toLowerCase();
    var m;

    if ((m = /has not activated the model\s+([^\s.,;:]+)/i.exec(s)) ||
        (m = /model\s+([^\s.,;:]+)\s+(?:is\s+)?not\s+activated/i.exec(s))) {
      return '你的账号还没开通模型「' + m[1] + '」：请到服务商控制台开通该模型后重试，或换一个已开通的模型。';
    }
    if (/activate the model|activate the service|model service in the/.test(low)) {
      return '该模型尚未开通：请到服务商控制台开通模型服务后重试。';
    }
    if (/insufficient[_ ]?quota|exceeded your current quota|quota exceeded|out of quota|insufficient balance| arrears|欠费|余额不足/.test(low)) {
      return '账户额度不足或已欠费：请到服务商控制台充值后重试。';
    }
    if (status === 429 || /rate.?limit|too many requests/.test(low)) {
      return '请求太频繁，已被服务商限流：请等一会儿再试。';
    }
    if (status === 401 || /invalid[_ ]?api[_ ]?key|incorrect api key|api key (?:is )?invalid|unauthorized|authentication failed/.test(low)) {
      return 'Key 无效或没有权限：请检查 Key 是否填对、是否属于该服务商。';
    }
    if (/context length|maximum context|too many tokens|token limit|input is too long/.test(low)) {
      return '输入内容太长，超过该模型的上下文上限：请缩短内容，或换用支持长上下文的模型。';
    }
    if (/content filter|safety|moderation|sensitive/.test(low)) {
      return '内容被服务商的安全策略拦截：请调整措辞后重试。';
    }
    if (status === 404 || /model[^.]{0,48}(not found|not exist|does not exist|invalid|unknown)|no such model|invalid model/.test(low)) {
      return '模型名不存在或当前账号无权使用：请检查模型名，或点「获取模型列表」重新选择。';
    }
    if (/temporarily unavailable|overloaded|service unavailable|internal server error|bad gateway/.test(low) || status >= 500) {
      return '服务商暂时不可用（HTTP ' + status + '）：请稍后重试。';
    }
    if (status === 400) {
      return '请求被服务商拒绝（HTTP 400）：请检查模型名、接口地址和参数。';
    }
    return '调用失败（HTTP ' + status + '）：请检查 Key、模型名和接口地址。';
  }

  function httpError(status, text) {
    var j = null;
    try { j = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    var rawMsg = errText(j);
    var msg = rawMsg || ('HTTP ' + status);
    if (status === 401) {
      msg = cfg.own
        ? '你填的 Key 无效或已过期：请在「AI 设置」里换一个。'
        : (cfg.hosted
          ? '站点 Key 无效或已过期：请联系站点管理员，或在「AI 设置」里改用自己的 Key。'
          : 'Key 无效或已过期：请点右上角「AI 设置」换一个可用 Key（或改 server/config.json）。');
    } else if (status === 403) {
      msg = rawMsg || '需要访问码：请使用带 ?code= 的链接打开本站';
      askCode();
    } else {
      msg = zhUpstream(status, rawMsg || text);
    }
    var err = new Error(msg);
    err.code = 'HTTP'; err.status = status; err.raw = j; err.rawText = rawMsg;
    return err;
  }

  function req(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    var ck = codeHeader();
    for (var c in ck) if (Object.prototype.hasOwnProperty.call(ck, c)) headers[c] = ck[c];
    if (opts.llm) {
      var h = llmHeaders();
      for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) headers[k] = h[k];
    }
    return fetch(api(path), {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) { /* 非 JSON */ }
        if (!r.ok) throw httpError(r.status, t);
        return j;
      });
    });
  }

  function netErr(e) {
    if (e && e.code) return e;
    var err = new Error(cfg.hosted
      ? '连不上站点服务：请检查网络后刷新重试。'
      : '连不上本地代理：请先双击 start.bat 启动服务（或点右上角「AI 设置 → 测试连接」）');
    err.code = 'NETWORK';
    return err;
  }

  function chat(messages, opts) {
    opts = opts || {};
    if (!activeLlm()) return Promise.reject(notConnected());
    var body = {
      messages: messages,
      model: opts.model || cfg.model,
      temperature: opts.temperature != null ? opts.temperature : cfg.temperature,
      max_tokens: opts.maxTokens || cfg.maxTokens,
      stream: !!opts.stream,
    };
    if (body.stream) return streamChat(body, opts.onChunk);
    return req('/api/chat', { method: 'POST', body: body, llm: true }).then(function (j) {
      var m = j.choices && j.choices[0] && j.choices[0].message;
      var c = m && m.content;
      if (!c) {
        var rs = m && m.reasoning_content;
        if (rs && (opts.maxTokens || 0) < 8192) {
          // 推理模型的思考吃光了预算：放大 4 倍重试一次
          return chat(messages, Object.assign({}, opts, {
            maxTokens: Math.min(16384, (opts.maxTokens || cfg.maxTokens || 4096) * 4),
          }));
        }
        throw new Error(rs
          ? '模型把 token 用在思考上、没输出正文：请在「AI 设置」里换更强的模型，或调大 max_tokens'
          : ('接口返回异常：' + JSON.stringify(j).slice(0, 140)));
      }
      return c;
    }, function (e) { throw netErr(e); });
  }

  /** 单次 SSE 请求：resolve { text, finish, hadReasoning } */
  function streamOnce(body, onChunk) {
    var headers = { 'Content-Type': 'application/json' };
    var ck = codeHeader();
    for (var c in ck) if (Object.prototype.hasOwnProperty.call(ck, c)) headers[c] = ck[c];
    var lh = llmHeaders();
    for (var k in lh) if (Object.prototype.hasOwnProperty.call(lh, k)) headers[k] = lh[k];
    return fetch(api('/api/chat'), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) { throw httpError(r.status, t); });
      }
      var rd = r.body.getReader();
      var dec = new TextDecoder();
      var buf = '', out = '', finish = null, reasoned = false;
      function pump() {
        return rd.read().then(function (x) {
          if (x.done) return { text: out, finish: finish, hadReasoning: reasoned };
          buf += dec.decode(x.value, { stream: true });
          var i = buf.indexOf('\n');
          while (i >= 0) {
            var line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (line.indexOf('data:') === 0) {
              var d = line.slice(5).trim();
              if (d === '[DONE]') return { text: out, finish: finish, hadReasoning: reasoned };
              try {
                var j = JSON.parse(d);
                var ch = j.choices && j.choices[0];
                var delta = ch && ch.delta;
                if (delta) {
                  if (delta.reasoning_content) reasoned = true;
                  if (delta.content) {
                    out += delta.content;
                    if (onChunk) onChunk(delta.content, out);
                  }
                }
                if (ch && ch.finish_reason) finish = ch.finish_reason;
              } catch (e) { /* 忽略半包 */ }
            }
            i = buf.indexOf('\n');
          }
          return pump();
        });
      }
      return pump();
    }, function (e) { throw netErr(e); });
  }

  /** SSE 流式：逐块回调 onChunk(text)，最终 resolve 全文 */
  function streamChat(body, onChunk) {
    if (!activeLlm()) return Promise.reject(notConnected());
    // 服务端不支持流式（例如 CloudBase 云函数）：退回一次性请求，整段结果一次回调
    if (!cfg.stream || cfg.serverStream === false) {
      return chat(body.messages || [], {
        model: body.model,
        temperature: body.temperature,
        maxTokens: body.max_tokens,
      }).then(function (t) {
        if (t && onChunk) onChunk(t, t);
        return t;
      });
    }
    return streamOnce(body, onChunk).then(function (res) {
      if (res.text) return res.text;
      // 推理模型的思考吃光了预算：放大 4 倍重试一次
      if (res.finish === 'length' && (body.max_tokens || 0) < 8192) {
        var bigger = Object.assign({}, body, {
          max_tokens: Math.min(16384, (body.max_tokens || cfg.maxTokens || 4096) * 4),
        });
        return streamOnce(bigger, onChunk).then(function (r2) {
          if (r2.text) return r2.text;
          throw new Error('模型把 token 用在思考上、没输出正文：请在「AI 设置」里换更强的模型，或调大 max_tokens');
        });
      }
      if (res.hadReasoning) {
        throw new Error('模型把 token 用在思考上、没输出正文：请在「AI 设置」里换更强的模型，或调大 max_tokens');
      }
      return '';
    });
  }

  function extractJson(t) {
    var s = String(t || '');
    var i = s.indexOf('{');
    if (i < 0) return null;
    var a = s.slice(i), b = a.lastIndexOf('}');
    if (b < 0) return null;
    return a.slice(0, b + 1);
  }

  /** 要求模型只回 JSON；解析失败时带一次纠正重试 */
  function chatJSON(messages, opts) {
    opts = opts || {};
    opts.maxTokens = opts.maxTokens || 2048;
    return chat(messages, opts).then(function (t) {
      var frag = extractJson(t);
      if (frag) {
        try { return JSON.parse(frag); } catch (e) { /* 下面重试 */ }
      }
      messages = messages.concat([{ role: 'user', content: '上一次输出不是合法 JSON。请只输出 JSON 对象本身，不要任何说明文字、不要 ``` 包裹。' }]);
      return chat(messages, opts).then(function (t2) {
        var f2 = extractJson(t2);
        if (!f2) throw new Error('模型没有返回 JSON，请重试');
        return JSON.parse(f2);
      });
    });
  }

  var $ = function (id) { return document.getElementById(id); };

  /** 服务商的品牌图标（内联 SVG）；没有就退回字母标记 */
  function paintMark(el, p) {
    if (!el) return;
    var svg = window.BrandIcons && window.BrandIcons[p.id];
    if (svg) { el.innerHTML = svg; el.classList.add('has-icon'); }
    else { el.textContent = p.mark; el.classList.remove('has-icon'); }
  }

  /** 温度读数的中文档位，帮用户直观理解滑块的松紧 */
  function tempWord(v) {
    if (v <= 0.3) return '稳定';
    if (v <= 0.7) return '平衡';
    return '发散';
  }
  function syncTemp() {
    var t = $('aiTemp'); if (!t) return;
    var v = Number(t.value);
    var tv = $('aiTempVal'); if (tv) tv.textContent = v.toFixed(1);
    var tw = $('aiTempWord'); if (tw) tw.textContent = tempWord(v);
    t.setAttribute('aria-valuetext', v.toFixed(1) + ' · ' + tempWord(v));
  }
  window.RPTemp = { sync: syncTemp, word: tempWord };

  /** 设置页底部提示：出错时标红；英文原文放进 title，鼠标悬停才显示 */
  function setHint(text, isError, detail) {
    var h = $('aiHint');
    if (!h) return;
    h.textContent = text || '';
    if (isError) h.classList.add('is-error'); else h.classList.remove('is-error');
    if (detail) h.title = String(detail).slice(0, 400); else h.removeAttribute('title');
  }
  window.RPHint = setHint;

  /* ---- 设置面板：填充与模型列表（与 AI 同一作用域） ---- */

  function fillSettings() {
    var p = curProv();
    var configured = !!pKey(p.id) && !!pBase(p.id);

    var nameEl = $('aiProvName'); if (nameEl) nameEl.textContent = p.name;
    paintMark($('aiProvIcon'), p);

    var badge = $('aiProvState');
    if (badge) {
      badge.textContent = configured ? '已配置' : '未配置';
      badge.className = 'ai-badge' + (configured ? ' is-ok' : '');
    }

    var link = $('aiProvLink');
    if (link) {
      if (p.link) { link.href = p.link; link.hidden = false; }
      else { link.hidden = true; link.removeAttribute('href'); }
    }

    var key = $('aiKey');
    if (key) {
      key.value = pKey(p.id);
      key.disabled = false;
      key.placeholder = '填入 ' + p.name + ' 的 API Key';
    }
    var kNote = $('aiKeyNote');
    if (kNote) kNote.textContent = '只保存在本浏览器，不会上传到站点；请求经同源代理转发。';

    var base = $('aiBaseURL');
    if (base) {
      base.value = pBase(p.id);
      base.disabled = false;
      base.placeholder = p.base || 'https://你的服务商/v1';
    }
    var bNote = $('aiBaseNote');
    if (bNote) bNote.textContent = p.id === 'custom' ? '需 OpenAI 兼容' : 'OpenAI 兼容';

    var mi = $('aiModel');
    if (mi) mi.value = pModel(p.id);
    var mState = $('aiModelState');
    if (mState) mState.textContent = mi && mi.value ? '已选 ' + mi.value : '尚未获取';

    var t = $('aiTemp'); if (t) t.value = cfg.temperature;
    syncTemp();
    var mt = $('aiMaxTokens'); if (mt) mt.value = cfg.maxTokens;
    var st = $('aiStream');
    if (st) {
      st.checked = !!cfg.stream;
      st.disabled = cfg.serverStream === false;
      st.title = cfg.serverStream === false ? '当前部署（云函数）不支持流式输出，只能用一次性返回' : '';
    }

    setHint(activeLlm()
      ? '当前使用你自己配置的 Key · ' + p.name
      : '当前未连接大模型：填入 Key 并保存后即可使用。', false);

    // 页标题下的状态行（与页首说明不重复）
    var sub = $('aiSub');
    if (sub) {
      sub.textContent = activeLlm()
        ? '当前：' + p.name + ' · 已保存 Key' + (pModel(p.id) ? ' · ' + pModel(p.id) : '')
        : '当前未连接大模型。填入自己的 Key 后即可使用 AI；不配置时仍可用规则版优化。';
    }

    renderProviders();
    fillModelOptions();
  }

  function renderProviders() {
    var box = $('aiProvList');
    if (!box) return;
    var cur = curId();
    box.innerHTML = '';
    PROVIDERS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ai-prov' + (p.id === cur ? ' is-on' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', p.id === cur ? 'true' : 'false');

      var mark = document.createElement('span');
      mark.className = 'ai-prov-mark';
      paintMark(mark, p);

      var txt = document.createElement('span');
      txt.className = 'ai-prov-txt';
      var nm = document.createElement('span');
      nm.className = 'ai-prov-name';
      nm.textContent = p.name;
      var sub = document.createElement('span');
      sub.className = 'ai-prov-sub';
      sub.textContent = (pKey(p.id) && pBase(p.id)) ? '已配置' : '待配置';
      txt.appendChild(nm);
      txt.appendChild(sub);

      var chk = document.createElement('span');
      chk.className = 'ai-prov-check';
      chk.textContent = '✓';

      b.appendChild(mark);
      b.appendChild(txt);
      b.appendChild(chk);
      b.addEventListener('click', function () { selectProvider(p.id); });
      box.appendChild(b);
    });
  }

  function fillModelOptions() {
    var dl = $('aiModelList');
    if (!dl) return;
    var list = modelLists[curId()] || [];
    dl.innerHTML = '';
    list.forEach(function (id) {
      var o = document.createElement('option');
      o.value = id;
      dl.appendChild(o);
    });
  }

  /** 切换服务商前先把当前输入暂存，避免来回切丢掉刚填的 Key */
  function stashDraft() {
    if (!own) return;
    var id = curId();
    if (!own.keys) own.keys = {};
    if (!own.bases) own.bases = {};
    if (!own.models) own.models = {};
    var m = $('aiModel');
    if (m) own.models[id] = m.value.trim();
    if (id === 'site') return;
    var k = $('aiKey');
    if (k && k.value.trim()) own.keys[id] = k.value.trim();
    var b = $('aiBaseURL');
    if (b) own.bases[id] = b.value.trim();
  }

  function selectProvider(id) {
    stashDraft();
    own = own || { provider: id, keys: {}, bases: {}, models: {} };
    own.provider = id;
    ownSave(own);
    fillSettings();
    if (pKey(id)) fetchModels(true);
  }

  function draftLlm() {
    var p = curProv();
    var k = $('aiKey') ? $('aiKey').value.trim() : '';
    var b = $('aiBaseURL') ? $('aiBaseURL').value.trim() : '';
    var m = $('aiModel') ? $('aiModel').value.trim() : '';
    if (!k || !b) return null;
    return { base: b, key: k, model: m };
  }

  function fetchModels(silent) {
    var p = curProv();
    var st = $('aiModelState');
    var btn = $('aiFetchModels');
    var spec = draftLlm();
    if (!spec) {
      if (!silent) setHint('先填接口地址和 API Key，再获取模型列表。', true);
      return;
    }
    if (st) st.textContent = '获取中…';
    if (btn) btn.disabled = true;
    AI.modelsFor(spec).then(function (list) {
      if (btn) btn.disabled = false;
      modelLists[p.id] = list;
      if (!list.length) {
        if (st) st.textContent = '未获取到';
        if (!silent) setHint('这个接口没有返回模型列表，可以直接手填模型名。', false);
        return;
      }
      var mi = $('aiModel');
      var keep = (mi && mi.value.trim()) || pModel(p.id);
      var pick = (keep && list.indexOf(keep) >= 0) ? keep : list[0];
      if (mi) mi.value = pick;
      if (st) st.textContent = list.length + ' 个可选';
      fillModelOptions();
    }, function (e) {
      if (btn) btn.disabled = false;
      if (st) st.textContent = '获取失败';
      if (!silent) setHint((e && e.message) ? e.message : '获取模型列表失败。', true, e && e.rawText);
    });
  }

  /** 左侧栏的 AI 状态：只有用户自己配好 Key 才算已连接 */
  function syncSideAi() {
    var sideAi = document.getElementById('sideAiState');
    if (!sideAi) return;
    var a = activeLlm();
    sideAi.textContent = a ? ('AI · 已连接' + (a.model ? ' · ' + a.model : '')) : 'AI · 未连接';
  }

  var AI = {
    load: function () {
      return req('/api/config').then(function (j) {
        cfg = {
          baseURL: '', model: '',
          temperature: j.temperature,
          stream: j.stream !== false, serverStream: j.stream !== false,
          maxTokens: j.maxTokens || 4096,
          // 站点不再内置可用的 Key：只有用户自己保存的 Key 才算「已连接」
          hasKey: false, hosted: !!j.hosted, own: false,
        };
        loaded = true;
        // 浏览器里保存的偏好 / 自带 Key 是唯一来源
        own = ownLoad();
        if (own && own.provider === 'site') delete own.provider;
        applyPrefs();
        syncSideAi();
        var btn = document.getElementById('btnAiSettings');
        if (btn) btn.hidden = false;
        return cfg;
      }, function () { loaded = false; throw netErr(); });
    },
    isLoaded: function () { return loaded; },
    get: function () { return cfg; },
    providers: function () { return PROVIDERS; },
    fillSettings: fillSettings,
    currentProvider: curProv,
    selectProvider: selectProvider,
    /** 保存：只写本浏览器（不再有站点内置 Key） */
    save: function (p) {
      var pid = (p.provider && provById(p.provider).id) || curId();
      own = own || { provider: pid, keys: {}, bases: {}, models: {} };
      if (!own.keys) own.keys = {};
      if (!own.bases) own.bases = {};
      if (!own.models) own.models = {};
      own.provider = pid;
      if (p.temperature != null) own.temperature = p.temperature;
      if (p.maxTokens) own.maxTokens = p.maxTokens;
      if (p.stream != null) own.stream = !!p.stream;
      own.models[pid] = (p.model || '').trim();

      var base = (p.base || '').trim();
      var key = (p.key || '').trim();
      if (!key || !base) {
        var e = new Error(key ? '请填接口地址' : '请先填这个服务商的 API Key');
        e.code = 'INPUT';
        return Promise.reject(e);
      }
      if (!/^https?:\/\//i.test(base)) {
        var e3 = new Error('接口地址要以 http(s):// 开头');
        e3.code = 'INPUT';
        return Promise.reject(e3);
      }
      own.keys[pid] = key;
      own.bases[pid] = base;
      ownSave(own);

      cfg.temperature = own.temperature != null ? own.temperature : cfg.temperature;
      cfg.maxTokens = own.maxTokens || cfg.maxTokens;
      cfg.stream = own.stream != null ? (!!own.stream && cfg.serverStream !== false) : cfg.stream;
      applyPrefs();
      syncSideAi();
      return Promise.resolve(cfg);
    },
    models: function () {
      return AI.modelsFor(activeLlm()).catch(function () { return []; });
    },
    /** spec = { base, key, model }；不传 = 用站点 / 本机代理 */
    modelsFor: function (spec) {
      var headers = {};
      var ck = codeHeader();
      for (var c in ck) if (Object.prototype.hasOwnProperty.call(ck, c)) headers[c] = ck[c];
      if (spec && spec.base && spec.key) {
        headers['x-llm-base'] = spec.base;
        headers['x-llm-key'] = spec.key;
        headers['x-llm-model'] = spec.model || '';
      }
      return fetch(api('/api/models'), { headers: headers }).then(function (r) {
        return r.text().then(function (t) {
          if (!r.ok) throw httpError(r.status, t);
          var j = null;
          try { j = JSON.parse(t); } catch (e) { /* 非 JSON */ }
          var list = (j && (j.data || j.models)) || [];
          return list.map(function (x) { return typeof x === 'string' ? x : x.id; }).filter(Boolean);
        });
      }).catch(function (e) {
        // 对着自己填的 Key 报错时，别再提「站点 Key」
        if (spec && spec.key && e && e.status === 401) {
          var err = new Error('这个接口的 Key 无效或没有权限，请检查后重试');
          err.code = 'HTTP'; err.status = 401;
          throw err;
        }
        throw e;
      });
    },
    chat: chat,
    chatJSON: chatJSON,
    /** 流式：stream(messages, { maxTokens, onChunk }) → resolve 全文 */
    stream: function (messages, opts) {
      opts = opts || {};
      return streamChat({
        messages: messages,
        model: opts.model || cfg.model,
        temperature: opts.temperature != null ? opts.temperature : cfg.temperature,
        max_tokens: opts.maxTokens || cfg.maxTokens,
        stream: true,
      }, opts.onChunk);
    },
    fillSettings: fillSettings,
    refreshModels: fetchModels,
    /** 清除浏览器里保存的自带 Key / 偏好 */
    forgetOwn: function () {
      own = null;
      modelLists = {};
      try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
      cfg.own = false;
      cfg.hasKey = false;
      cfg.model = '';
      syncSideAi();
    },
    /** 打开设置面板并填入当前配置（独立视图；无 App 时退回旧浮层） */
    openSettings: function () {
      var show = function () {
        fillSettings();
        if (window.App && window.App.showSettings) { window.App.showSettings(); return; }
        var ov = $('aiOverlay');
        if (ov) ov.hidden = false;
      };
      if (!loaded) return AI.load().then(show, show);
      show();
    },
    /** 连通性测试：返回 { ok, model, latencyMs, error } */
    test: function () {
      var t0 = Date.now();
      return chat([{ role: 'user', content: '只回复两个字：连通' }], { maxTokens: 256 })
        .then(function (t) { return { ok: true, model: cfg.model, latencyMs: Date.now() - t0, reply: t.slice(0, 20) }; })
        .catch(function (e) { return { ok: false, latencyMs: Date.now() - t0, error: e.message, raw: e.rawText || '' }; });
    },
  };

  window.AI = AI;
})();

/* ---------------- 设置面板（ai.js 自带 UI 绑定） ---------------- */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };

  function bindSettings() {
    var temp = $('aiTemp');
    if (temp) temp.addEventListener('input', function () {
      if (window.RPTemp) window.RPTemp.sync();
    });

    // 密码显隐
    var eye = $('aiEye');
    if (eye) eye.addEventListener('click', function () {
      var k = $('aiKey');
      if (!k) return;
      var show = k.type === 'password';
      k.type = show ? 'text' : 'password';
      eye.textContent = show ? '隐藏' : '显示';
    });

    // 获取模型列表
    var fetchBtn = $('aiFetchModels');
    if (fetchBtn) fetchBtn.addEventListener('click', function () {
      window.AI.refreshModels(false);
    });

    var save = $('aiSave');
    if (save) save.addEventListener('click', function () {
      var payload = {
        provider: window.AI.currentProvider().id,
        key: $('aiKey') ? $('aiKey').value.trim() : '',
        base: $('aiBaseURL') ? $('aiBaseURL').value.trim() : '',
        model: $('aiModel') ? $('aiModel').value.trim() : '',
        temperature: Number($('aiTemp').value),
        maxTokens: Number($('aiMaxTokens').value) || 4096,
        stream: $('aiStream').checked,
      };
      if (window.RPHint) window.RPHint('保存中…', false);
      window.AI.save(payload).then(function (r) {
        window.AI.fillSettings();
        if (window.RPHint) window.RPHint((r.own ? '已切到你自己的 Key · ' : '已保存 · ') + (r.model || ''), false);
        if (window.App) window.App.toast(r.own ? '已切换为你自己的 Key' : 'AI 设置已保存');
      }).catch(function (e) {
        if (window.RPHint) window.RPHint(e.message, true, e.rawText);
      });
    });

    var test = $('aiTest');
    if (test) test.addEventListener('click', function () {
      var payload = {
        provider: window.AI.currentProvider().id,
        key: $('aiKey') ? $('aiKey').value.trim() : '',
        base: $('aiBaseURL') ? $('aiBaseURL').value.trim() : '',
        model: $('aiModel') ? $('aiModel').value.trim() : '',
        temperature: Number($('aiTemp').value),
        maxTokens: Number($('aiMaxTokens').value) || 4096,
        stream: $('aiStream').checked,
      };
      if (window.RPHint) window.RPHint('测试中…', false);
      // 先保存再测，避免「测的是旧配置」
      window.AI.save(payload).then(function () {
        return window.AI.test();
      }).then(function (r) {
        // 先刷新面板（会重置提示文案），再写测试结果，避免结果被覆盖
        if (r.ok) window.AI.fillSettings();
        if (r.ok) {
          if (window.RPHint) window.RPHint('连通成功 · ' + r.model + ' · ' + r.latencyMs + 'ms ·「' + r.reply + '」', false);
        } else {
          if (window.RPHint) window.RPHint('连接失败：' + r.error, true, r.raw);
        }
      }).catch(function (e) {
        if (window.RPHint) window.RPHint(e.message, true, e.rawText);
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bindSettings();
    // 无代理（file:// 双击打开、后端未起）时也先把服务商列表铺好，仍可手填 Key
    if (window.AI && window.AI.fillSettings) window.AI.fillSettings();
    window.AI.load().then(function () { window.AI.fillSettings(); }).catch(function () { /* 无代理时静默，前端照常降级 */ });
  });
})();

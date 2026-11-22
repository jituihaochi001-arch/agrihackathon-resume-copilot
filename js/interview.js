/* interview.js — 模拟面试：文字对谈 + 逐题追问 + 评分报告 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var HKEY = 'rp-interview-history-v1';

  var ST = {
    phase: 'idle',          // idle | run | report
    cfg: null,
    log: [],                // {q, a, fb, depth, tSec}
    asked: 0,               // 独立题数（depth==0 计 1）
    startAt: 0, qStartAt: 0, timerId: null,
    report: null,
    busy: false,
  };

  /* ---------------- 上下文：把简历压成可读摘要 ---------------- */

  function digest() {
    var out = [];
    var m = window.App && window.App.state.base;
    if (m) {
      if (m.name) out.push('姓名：' + m.name);
      out.push('求职意向：' + (m.intent || '未填写'));
      var c = {};
      (m.contact || []).forEach(function (x) { c[x.label] = x.value; });
      out.push('联系方式：' + (c['电话'] || c['邮箱'] ? [c['电话'], c['邮箱']].filter(Boolean).join(' / ') : '未填写'));
      (m.sections || []).forEach(function (s) {
        if ((s.mode === 'para' && s.text) || s.type === 'summary') {
          out.push('【' + (s.heading || '个人简介') + '】' + (s.text || ''));
          return;
        }
        if (s.mode === 'chips' && (s.chips || []).length) {
          out.push('【' + (s.heading || s.type) + '】' + s.chips.join('、'));
          return;
        }
        if (!s.items || !s.items.length) return;
        out.push('【' + (s.heading || s.type) + '】');
        s.items.forEach(function (it) {
          out.push('· ' + [it.org, it.role, it.meta].filter(Boolean).join(' · '));
          (it.bullets || []).forEach(function (b) { out.push('   - ' + b); });
        });
      });
    }
    var jd = (window.App && window.App.state.rawJd) || '';
    if (jd) out.push('\n【目标 JD】\n' + jd.slice(0, 1200));
    var txt = out.join('\n');
    if (txt.length > 4200) txt = txt.slice(0, 4200) + '\n（简历过长，已截断）';
    return txt;
  }

  /* ---------------- 提示词 ---------------- */

  function sysPrompt() {
    var c = ST.cfg;
    return '你是资深面试官，正在对候选人进行一对一模拟面试。严格只输出 JSON，不要输出任何其它文字，也不要用 ``` 包裹。\n\n' +
      '【候选人背景】\n' + digest() + '\n\n' +
      '【目标岗位】' + (c.role || '未指定，按通用岗位出题') + '　【公司/行业】' + (c.company || '未指定') + '\n' +
      '【轮次】' + c.round + '　【难度】' + c.level + '　【总题量】' + c.count + ' 题　【深挖简历】' + (c.deep ? '是' : '否') + '\n\n' +
      '规则：\n' +
      '1. 一次只问一个问题。问题要具体、能区分水平，优先围绕简历里的项目、数据、技术决策与岗位核心能力。\n' +
      '2. 候选人每次回答后：先给 1-2 句具体点评（好在哪、缺什么，不说空话），再决定追问或换题。\n' +
      '3. 同一题最多追问 2 层；已问过的问题绝不重复。\n' +
      '4. 独立题目数达到 ' + c.count + ' 题后，action 输出 finish。\n' +
      '5. 候选人明确说「结束 / 不再答」时，直接 finish。\n' +
      '6. 字段：feedback(短评，可为空串)、action(question|finish)、question(下一题全文，finish 时为空串)、depth(当前题追问层数 0/1/2)。';
  }

  function turnMessages() {
    var msgs = [{ role: 'system', content: sysPrompt() }];
    ST.log.forEach(function (it, i) {
      msgs.push({ role: 'assistant', content: '第 ' + (i + 1) + ' 问' + (it.depth ? '（追问第 ' + it.depth + ' 层）' : '') + '：' + it.q + (it.fb ? '\n面试官点评：' + it.fb : '') });
      msgs.push({ role: 'user', content: it.a === null ? '（此题被跳过）' : '候选人回答：\n' + it.a });
    });
    return msgs;
  }

  /* ---------------- 渲染 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function scrollBottom() {
    var box = $('ivMsgs');
    if (box) box.scrollTop = box.scrollHeight;
  }

  function addMsg(role, text, thinking) {
    var box = $('ivMsgs');
    if (!box) return;
    var div = document.createElement('div');
    div.className = 'iv-msg iv-' + role + (thinking ? ' thinking' : '');
    var who = document.createElement('span');
    who.className = 'iv-who';
    who.textContent = role === 'me' ? '你' : (role === 'sys' ? '系统' : '面试官');
    var body = document.createElement('div');
    body.className = 'iv-body';
    if (role === 'q') {
      body.dataset.raw = text;
      body.textContent = '';
      typewrite(body, text);
    } else {
      body.textContent = text;
    }
    div.appendChild(who);
    div.appendChild(body);
    box.appendChild(div);
    scrollBottom();
  }

  function typewrite(el, text) {
    var i = 0, raw = String(text);
    var t = setInterval(function () {
      i += 3;
      el.textContent = raw.slice(0, i);
      scrollBottom();
      if (i >= raw.length) clearInterval(t);
    }, 16);
  }

  function renderProgress() {
    var c = ST.cfg;
    if (!c) return;
    $('ivCount').textContent = ST.asked + ' / ' + c.count;
    $('ivProgressText').textContent = ST.asked >= c.count ? '题量已满，正在收尾' : '第 ' + Math.max(1, Math.min(ST.asked, c.count)) + ' 题';
    $('ivProgFill').style.width = Math.min(100, (ST.asked / c.count) * 100) + '%';
  }

  function fmt(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  /** 面试未开始（idle）时显示空状态，开始后切回对话区 */
  function syncIdle() {
    var idle = ST.phase !== 'run' && ST.phase !== 'report';
    var e = $('ivEmpty');
    if (e) e.hidden = !idle;
    var m = $('ivMsgs'); if (m) m.hidden = idle;
    var f = $('ivForm'); if (f) f.hidden = idle || ST.phase === 'report';
    var sh = document.querySelector('.iv-shell');
    if (sh) sh.classList.toggle('is-idle', idle);
    if (!idle) return;

    var st = window.App && window.App.state;
    var note = $('ivEmptyNote');
    if (note) note.textContent = (st && st.base)
      ? '已带入当前简历' + (st.rawJd ? '与 JD' : '') + '：' + (st.fileName || '未命名简历')
      : '还没上传简历，只能按岗位出通用题；先去「我的简历」上传，题目会更贴合你。';
    var startBtn = $('ivEmptyStart');
    if (startBtn) startBtn.textContent = (st && st.base) ? '配置并开始 →' : '选岗位直接开练 →';

    if ($('ivRound')) $('ivRound').textContent = '—';
    if ($('ivCtx')) $('ivCtx').textContent = '—';
    if ($('ivProgressText')) $('ivProgressText').textContent = '准备中';
    if ($('ivCount')) $('ivCount').textContent = '0/0';
    if ($('ivProgFill')) $('ivProgFill').style.width = '0%';
    if ($('ivTimer')) $('ivTimer').textContent = '00:00';
  }

  function tick() {
    var el = $('ivTimer');
    if (!el || !ST.cfg) return;
    var total = Math.floor((Date.now() - ST.startAt) / 1000);
    var q = ST.cfg.timing ? Math.floor((Date.now() - ST.qStartAt) / 1000) : 0;
    el.textContent = '';
    el.innerHTML = (ST.cfg.timing ? '本题 ' + fmt(q) + '<br>' : '') + '总 ' + fmt(total);
  }

  function setBusy(b) {
    ST.busy = b;
    var send = $('ivSend'), ta = $('ivTa');
    if (send) send.disabled = b;
    if (ta) ta.disabled = b;
    if (b) { addMsg('sys', '面试官正在思考…', true); }
    else {
      var t = $('ivMsgs').querySelector('.iv-sys.thinking');
      if (t) t.remove();
    }
  }

  /* ---------------- 主流程 ---------------- */

  function enter() {
    syncIdle();
    if (ST.phase === 'run' || ST.phase === 'report') {
      if (window.App && window.App.activateView) window.App.activateView('interview');
      return;
    }
    openStart();
  }

  function openStart() {
    var app = window.App;
    var roleEl = $('ivRole');
    if (roleEl && app && app.state.jd && app.state.jd.title && !roleEl.value) roleEl.value = app.state.jd.title;
    renderHistory();
    $('ivStartHint').textContent = app && app.state.base ? '已带入当前简历与 JD' : '未上传简历：将只按岗位与轮次出题，无法深挖项目';
    app.openOverlay('ivStartOverlay');
  }

  function start() {
    var app = window.App;
    var c = {
      role: $('ivRole').value.trim(),
      company: $('ivCompany').value.trim(),
      round: $('ivRoundSel').value,
      level: $('ivLevel').value,
      count: +$('ivTotal').value,
      timing: $('ivTiming').checked,
      deep: $('ivDeep').checked,
    };
    if (!c.role && !app.state.base) {
      $('ivStartHint').textContent = '没上传简历时，请至少填目标岗位，否则无法出题';
      return;
    }
    ST.cfg = c;
    ST.phase = 'run';
    ST.log = [];
    ST.asked = 0;
    ST.startAt = Date.now();
    ST.qStartAt = Date.now();
    syncIdle();
    app.closeOverlay('ivStartOverlay');

    if (window.App && window.App.activateView) window.App.activateView('interview');
    $('ivRound').textContent = c.round + ' · ' + c.level;
    $('ivCtx').textContent = (c.role || '通用岗位') + (c.company ? ' · ' + c.company : '') + ' · ' + c.count + ' 题' + (c.deep ? ' · 深挖简历' : '');
    $('ivMsgs').innerHTML = '';
    $('ivTa').value = '';
    renderProgress();
    addMsg('sys', '面试开始：' + c.round + ' · ' + c.level + ' · 共 ' + c.count + ' 题' + (c.timing ? ' · 计时中' : ''));
    window.scrollTo(0, 0);

    clearInterval(ST.timerId);
    ST.timerId = setInterval(tick, 1000);
    tick();
    ask('开始面试，请出第 1 题。');
  }

  function ask(userText) {
    setBusy(true);
    var msgs = turnMessages();
    msgs.push({ role: 'user', content: userText + '\n\n（已问独立题目 ' + ST.asked + ' 题 / 共 ' + ST.cfg.count + ' 题，请按规则输出 JSON。）' });
    window.AI.chatJSON(msgs, { maxTokens: 4096 }).then(function (j) {
      setBusy(false);
      var action = j && j.action;
      if (action === 'finish' || ST.asked >= ST.cfg.count) {
        return report();
      }
      var fb = String(j.feedback || '');
      var q = String((j && j.question) || '').trim();
      if (!q) { return ask('上一条输出没有题目，请直接给出下一个问题。'); }
      var depth = Math.min(2, +(j.depth) || 0);

      // 点评归属于刚答完的上一题；新题另起一条，fb 留空
      var prev = ST.log[ST.log.length - 1];
      if (prev && !prev.fb) prev.fb = fb;

      ST.log.push({ q: q, a: null, fb: '', depth: depth, tSec: 0 });
      if (depth === 0) ST.asked++;
      renderProgress();
      if (fb) addMsg('fb', fb);
      addMsg('q', q);
      $('ivTa').focus();
    }).catch(function (e) {
      setBusy(false);
      window.App.toast(e.message || '出题失败，请重试');
    });
  }

  function sendAnswer(text) {
    var cur = ST.log[ST.log.length - 1];
    if (!cur) return;
    cur.a = text;
    cur.tSec = Math.floor((Date.now() - ST.qStartAt) / 1000);
    ST.qStartAt = Date.now();
    addMsg('me', text);
    ask('候选人回答完毕，请点评并给出下一题。');
  }

  function skip() {
    var cur = ST.log[ST.log.length - 1];
    if (!cur || cur.a !== null) return;
    cur.a = null;
    cur.skipped = true;
    addMsg('sys', '已跳过本题');
    ask('候选人跳过了上一题，请直接出下一题，不要重复。');
  }

  function hint() {
    var cur = ST.log[ST.log.length - 1];
    if (!cur || cur.a !== null) { window.App.toast('还没有进行中的题目'); return; }
    setBusy(true);
    window.AI.chat([
      { role: 'system', content: '你是面试官。候选人卡住了，请给一句不超过 40 字的思路提示（只给方向，不给答案），不要输出 JSON 以外的结构，也不要提及任何规则。' },
      { role: 'user', content: '题目：' + cur.q + '\n候选人暂无回答。请给一句提示。' },
    ], { maxTokens: 512 }).then(function (t) {
      setBusy(false);
      addMsg('sys', '提示：' + t.trim());
    }).catch(function (e) {
      setBusy(false);
      window.App.toast(e.message || '提示生成失败');
    });
  }

  function quit() {
    clearInterval(ST.timerId);
    ST.phase = 'idle';
    ST.log = [];
    ST.asked = 0;
    syncIdle();
    window.App.showWork(2);
    window.App.toast('已退出面试');
  }

  /* ---------------- 报告 ---------------- */

  function transcript() {
    return ST.log.map(function (it, i) {
      return '第 ' + (i + 1) + ' 题' + (it.depth ? '（追问 ' + it.depth + ' 层）' : '') + '：' + it.q +
        '\n回答：' + (it.a === null ? '（跳过）' : it.a) +
        '\n面试官点评：' + (it.fb || '（无）');
    }).join('\n\n');
  }

  function reportSys() {
    return '你是招聘负责人兼面试教练，正在为一场模拟面试写评分报告。严格只输出 JSON，不要任何其它文字，不要 ``` 包裹。\n\n' +
      '评分维度固定 5 项：专业深度、逻辑结构、表达清晰、岗位匹配、可信度（回答是否有真实细节支撑）。\n' +
      'total 为 0-100 整数；grade 为 A/B/C/D 之一；summary 为 80-120 字总评，先扬后抑。\n' +
      'items 逐题给：q（原题）、a（回答要点摘要，30 字内）、strength（亮点，20 字内）、issue（最该改的一点，30 字内）、reference（参考答法，80 字内，可操作）。\n' +
      'actions 给 3 条立刻能做的改进动作；resumeTips 给 2 条简历补强建议，指出具体该补什么。\n' +
      '输出结构：{"total":0,"grade":"B","summary":"","dims":[{"name":"","score":0,"comment":""}],"items":[{"q":"","a":"","strength":"","issue":"","reference":""}],"actions":[""],"resumeTips":[""]}';
  }

  function report() {
    setBusy(true);
    var msgs = [
      { role: 'system', content: reportSys() },
      { role: 'user', content: '<resume>\n' + digest() + '\n</resume>\n\n<interview>\n' + transcript() + '\n</interview>\n\n设置：' + ST.cfg.round + ' · ' + ST.cfg.level + ' · 目标岗位 ' + (ST.cfg.role || '通用') + '。请输出评分报告 JSON。' },
    ];
    window.AI.chatJSON(msgs, { maxTokens: 8192 }).then(function (j) {
      if (!j || !j.items || !j.dims) throw new Error('报告结构不完整，请重试');
      ST.report = j;
      ST.phase = 'report';
      syncIdle();
      saveHistory(j);
      renderHub();
      renderReport(j);
      return closing();
    }).then(function () {
      setBusy(false);
    }).catch(function (e) {
      setBusy(false);
      window.App.toast(e.message || '报告生成失败');
    });
  }

  /** 流式输出一段收束语 */
  function closing() {
    var box = $('ivClosing');
    if (!box) return Promise.resolve();
    box.textContent = '';
    box.classList.add('is-typing');
    return window.AI.stream([
      { role: 'system', content: '你是面试教练。用 100-140 字给候选人一段收束语：先点出最有价值的一条表现，再指出最关键的一条短板，最后给一句可执行的下一步。语气直接但不说教，不要客套话。' },
      { role: 'user', content: '面试记录：\n' + transcript() + '\n\n请直接写收束语正文。' },
    ], { maxTokens: 2048, onChunk: function (chunk) {
      box.textContent += chunk;
      box.scrollTop = box.scrollHeight;
    } }).then(function () {
      if (!box.textContent.trim()) box.textContent = '（收束语生成失败，报告其余部分不受影响）';
    }).catch(function () {
      box.textContent = '（收束语生成失败，报告其余部分不受影响）';
    }).then(function () { box.classList.remove('is-typing'); });
  }

  function renderReport(j) {
    var c = ST.cfg;
    var dur = Math.floor((Date.now() - ST.startAt) / 1000);
    var html = '';

    html += '<div class="rpt-head"><div class="rpt-score"><b>' + (j.total || 0) + '</b><span>分</span></div>' +
      '<div class="rpt-head-r"><span class="rpt-grade">' + esc(j.grade || '—') + '</span>' +
      '<p class="rpt-role">' + esc(c.role || '通用岗位') + ' · ' + esc(c.round) + ' · ' + esc(c.level) + ' · ' + ST.log.length + ' 问 · 用时 ' + fmt(dur) + '</p>' +
      '<p class="rpt-summary">' + esc(j.summary || '') + '</p></div></div>';

    html += '<div class="rpt-sec"><span class="block-label">五维评分</span><ul class="rpt-dims">' +
      (j.dims || []).map(function (d) {
        return '<li><span class="n">' + esc(d.name) + '</span><span class="bar"><i style="width:' + Math.max(0, Math.min(100, d.score)) + '%"></i></span><span class="v">' + d.score + '</span><span class="c">' + esc(d.comment || '') + '</span></li>';
      }).join('') + '</ul></div>';

    html += '<div class="rpt-sec"><span class="block-label">逐题点评</span>' +
      (j.items || []).map(function (it, i) {
        return '<div class="rpt-item"><div class="rpt-q"><b>Q' + (i + 1) + '</b>' + esc(it.q) + '</div>' +
          '<div class="rpt-grid">' +
          '<div><span class="lbl">回答</span><p>' + esc(it.a) + '</p></div>' +
          '<div class="ok"><span class="lbl">亮点</span><p>' + esc(it.strength) + '</p></div>' +
          '<div class="bad"><span class="lbl">问题</span><p>' + esc(it.issue) + '</p></div>' +
          '<div class="ref"><span class="lbl">参考答法</span><p>' + esc(it.reference) + '</p></div>' +
          '</div></div>';
      }).join('') + '</div>';

    html += '<div class="rpt-sec"><span class="block-label">立刻能做的 3 件事</span><ol class="rpt-list">' +
      (j.actions || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ol></div>';

    html += '<div class="rpt-sec"><span class="block-label">简历补强方向</span><ul class="rpt-list">' +
      (j.resumeTips || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>';

    html += '<div class="rpt-sec"><span class="block-label">面试官收束语</span><p class="rpt-closing" id="ivClosing"></p></div>';

    $('ivReportBody').innerHTML = html;
    $('ivReportOverlay').hidden = false;
    closing();
  }

  /* ---------------- 历史记录 ---------------- */

  function loadHist() {
    try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch (e) { return []; }
  }
  function saveHistory(j) {
    var h = loadHist();
    h.unshift({
      id: Date.now(), at: new Date().toLocaleString('zh-CN'),
      role: ST.cfg.role || '通用岗位', round: ST.cfg.round, level: ST.cfg.level,
      count: ST.cfg.count, asked: ST.asked, qn: ST.log.length,
      score: j.total, grade: j.grade, durSec: Math.floor((Date.now() - ST.startAt) / 1000),
      report: j,
    });
    while (h.length > 10) h.pop();
    try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch (e) {}
  }
  function renderHistory() {
    var h = loadHist();
    var box = $('ivHist');
    if (!box) { renderHub(); return; }
    if (!h.length) { box.hidden = true; renderHub(); return; }
    box.hidden = false;
    $('ivHistList').innerHTML = h.map(function (x) {
      return '<li><button type="button" data-hid="' + x.id + '"><b>' + x.score + ' 分 · ' + esc(x.grade) + '</b>' +
        '<span>' + esc(x.role) + ' · ' + esc(x.round) + ' · ' + x.at + '</span></button></li>';
    }).join('');
    renderHub();
  }

  /** 「我的简历」页上的最近面试（最多 3 场） */
  function renderHub() {
    var box = $('hubHist');
    if (!box) return;
    var h = loadHist();
    if (!h.length) { box.hidden = true; return; }
    box.hidden = false;
    $('hubHistList').innerHTML = h.slice(0, 3).map(function (x) {
      return '<li><button type="button" data-hid="' + x.id + '">' +
        '<b>' + esc(x.role || '通用岗位') + ' · ' + x.score + ' 分 ' + esc(x.grade || '') + '</b>' +
        '<span>' + esc(x.round) + ' · ' + esc(x.at) + ' · 用时 ' + fmt(x.durSec) + '</span></button></li>';
    }).join('');
  }

  function showReportById(id) {
    var h = loadHist();
    for (var i = 0; i < h.length; i++) {
      if (String(h[i].id) === String(id)) {
        ST.cfg = { role: h[i].role, round: h[i].round, level: h[i].level, count: h[i].count, timing: true, deep: true };
        ST.log = []; ST.asked = h[i].qn || h[i].count || 0; ST.startAt = Date.now() - h[i].durSec * 1000;
        ST.report = h[i].report; ST.phase = 'report';
        syncIdle();
        if (window.App && window.App.activateView) window.App.activateView('interview');
        $('ivRound').textContent = h[i].round + ' · ' + h[i].level;
        $('ivCtx').textContent = h[i].role + ' · ' + h[i].qn + ' 问 · 用时 ' + fmt(h[i].durSec);
        $('ivMsgs').innerHTML = '';
        addMsg('sys', '历史面试报告（只读回顾）');
        renderProgress();
        clearInterval(ST.timerId); ST.timerId = setInterval(tick, 1000); tick();
        renderReport(h[i].report);
        return;
      }
    }
  }

  /* ---------------- 导出 / 打印 ---------------- */

  function reportMd() {
    var j = ST.report, c = ST.cfg;
    if (!j) return '';
    var L = [];
    L.push('# 模拟面试报告');
    L.push('');
    L.push('> 岗位：' + (c.role || '通用岗位') + ' ｜ 轮次：' + c.round + ' ｜ 难度：' + c.level + ' ｜ 时间：' + new Date().toLocaleString('zh-CN'));
    L.push('> 总分：**' + (j.total || 0) + ' / 100（' + (j.grade || '—') + '）**');
    L.push('');
    L.push('## 总评');
    L.push(j.summary || '');
    L.push('');
    L.push('## 五维评分');
    (j.dims || []).forEach(function (d) { L.push('- ' + d.name + '：**' + d.score + '** — ' + (d.comment || '')); });
    L.push('');
    L.push('## 逐题点评');
    (j.items || []).forEach(function (it, i) {
      L.push('### Q' + (i + 1) + ' ' + it.q);
      L.push('- 回答：' + (it.a || ''));
      L.push('- 亮点：' + (it.strength || ''));
      L.push('- 问题：' + (it.issue || ''));
      L.push('- 参考答法：' + (it.reference || ''));
      L.push('');
    });
    L.push('## 立刻能做的 3 件事');
    (j.actions || []).forEach(function (a, i) { L.push((i + 1) + '. ' + a); });
    L.push('');
    L.push('## 简历补强方向');
    (j.resumeTips || []).forEach(function (a) { L.push('- ' + a); });
    L.push('');
    L.push('---');
    L.push('由「简历精修 · 模拟面试」生成本地报告');
    return L.join('\n');
  }

  function exportMd() {
    if (!ST.report) return;
    var name = '模拟面试报告-' + (ST.cfg.role || '通用').replace(/[\\/:*?"<>|]/g, '') + '.md';
    window.ResumeRender.download(name, reportMd(), 'text/markdown;charset=utf-8');
    window.App.toast('已导出 Markdown 报告');
  }

  function printReport() {
    document.body.classList.add('print-report');
    window.print();
    setTimeout(function () { document.body.classList.remove('print-report'); }, 300);
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    $('ivForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var ta = $('ivTa');
      var v = ta.value.trim();
      if (!v || ST.busy || ST.phase !== 'run') return;
      ta.value = '';
      ta.style.height = 'auto';
      sendAnswer(v);
    });
    $('ivTa').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('ivForm').requestSubmit ? $('ivForm').requestSubmit() : $('ivForm').submit(); }
    });
    $('ivTa').addEventListener('input', function () {
      var ta = $('ivTa');
      ta.style.height = 'auto';
      ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
    });
    $('ivBtnSkip').addEventListener('click', skip);
    $('ivBtnHint').addEventListener('click', hint);
    $('ivBtnEnd').addEventListener('click', function () {
      if (ST.phase !== 'run') return;
      if (!ST.log.length) { window.App.toast('还没有题目可结束'); return; }
      ask('候选人主动结束面试，请直接 finish。');
    });
    $('ivBtnQuit').addEventListener('click', quit);
    $('ivBack').addEventListener('click', function () { window.App.showWork(2); });

    $('ivBtnStart').addEventListener('click', start);
    var emptyStart = $('ivEmptyStart');
    if (emptyStart) emptyStart.addEventListener('click', openStart);
    $('ivHistList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-hid]');
      if (b) showReportById(b.dataset.hid);
    });
    var hubList = $('hubHistList');
    if (hubList) hubList.addEventListener('click', function (e) {
      var b = e.target.closest('[data-hid]');
      if (b) showReportById(b.dataset.hid);
    });

    $('ivBtnExportMd').addEventListener('click', exportMd);
    $('ivBtnPrint').addEventListener('click', printReport);
    $('ivBtnAgain').addEventListener('click', function () {
      $('ivReportOverlay').hidden = true;
      openStart();
    });
    $('ivBtnBackWork').addEventListener('click', function () {
      $('ivReportOverlay').hidden = true;
      window.App.showWork(2);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    syncIdle();
    renderHub();
  });

  window.Interview = { enter: enter, openStart: openStart, renderHub: renderHub };
})();

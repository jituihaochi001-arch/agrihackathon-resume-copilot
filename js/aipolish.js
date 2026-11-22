/* aipolish.js — AI 版简历建议：输出结构化建议，复用现有「采纳」机制 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var busy = false;

  /** 把简历序列化成带定位标记的文本，同时记录标记 → 模型位置的映射 */
  function serialize(m) {
    var out = [], refs = {}, e = 0;
    function secHead(s) { return '【' + (s.heading || s.type) + '】'; }

    if (m.name) out.push('【姓名】' + m.name);
    out.push('【INTENT 求职意向】' + (m.intent || '（未填写）'));
    var contact = (m.contact || []).map(function (c) { return c.label + '：' + c.value; }).join('　');
    out.push('【CONTACT 联系方式】' + (contact || '（未填写）'));

    (m.sections || []).forEach(function (s) {
      if ((s.mode === 'para' && s.text) || s.type === 'summary') {
        out.push('【S1 ' + (s.heading || '个人简介') + '】' + (s.text || ''));
        refs.S1 = { kind: 'summary' };
        return;
      }
      if (s.mode === 'chips' && (s.chips || []).length) {
        var key = s.type === 'skills' ? 'SKILLS' : ('CHIPS-' + s.type).toUpperCase();
        out.push('【' + key + ' ' + (s.heading || s.type) + '】' + s.chips.join('、'));
        refs[key] = { kind: 'chips', secType: s.type };
        return;
      }
      if (!s.items || !s.items.length) return;
      s.items.forEach(function (it) {
        e++;
        var label = 'E' + e;
        out.push('【' + label + ' ' + (s.heading || s.type) + '】' + [it.org, it.role, it.meta].filter(Boolean).join(' · '));
        refs[label] = { kind: 'entry', secType: s.type, uid: it.uid };
        (it.bullets || []).forEach(function (b, i) {
          out.push('(' + label + ':B' + (i + 1) + ') ' + b);
        });
      });
    });
    return { text: out.join('\n'), refs: refs };
  }

  function norm(s) { return String(s || '').replace(/\s/g, ''); }

  /** 按标记定位并替换；标记失效时用 before 文本模糊兜底 */
  function applyRef(m, refs, ref, before, after) {
    var r = refs[ref];
    if (r) {
      if (r.kind === 'summary') {
        for (var i = 0; i < m.sections.length; i++) {
          if (m.sections[i].type === 'summary') { m.sections[i].text = after; return true; }
        }
        return false;
      }
      if (r.kind === 'chips') {
        for (var k = 0; k < m.sections.length; k++) {
          if (m.sections[k].type === r.secType) {
            m.sections[k].chips = after.split(/[,，、;；]/).map(function (x) { return x.trim(); }).filter(Boolean);
            return true;
          }
        }
        return false;
      }
      if (r.kind === 'entry') {
        var item = null;
        m.sections.forEach(function (s) {
          (s.items || []).forEach(function (it) { if (it.uid === r.uid) item = it; });
        });
        if (!item) return false;
        var mt = ref.match(/:B(\d+)$/);
        if (mt) {
          var idx = +mt[1] - 1;
          if (idx >= 0 && idx < item.bullets.length) { item.bullets[idx] = after; return true; }
          return false;
        }
        if (item.meta !== undefined) { item.meta = after; return true; }
        return false;
      }
    }
    // 兜底：按 before 前缀在所有要点里找
    var head = norm(before).slice(0, 12);
    if (head.length >= 4) {
      for (var a = 0; a < m.sections.length; a++) {
        var its = m.sections[a].items || [];
        for (var b = 0; b < its.length; b++) {
          for (var c = 0; c < its[b].bullets.length; c++) {
            if (norm(its[b].bullets[c]).indexOf(head) === 0) { its[b].bullets[c] = after; return true; }
          }
        }
      }
      var sum = m.sections.filter(function (s) { return s.type === 'summary'; })[0];
      if (sum && norm(sum.text || '').indexOf(head) === 0) { sum.text = after; return true; }
    }
    return false;
  }

  function systemPrompt() {
    return '你是顶级简历修改专家，擅长把「做过」改成「做成」。只改表述，绝不编造事实。\n\n' +
      '下面是带定位标记的简历与目标 JD。请给出最多 8 条可直接替换进简历的修改建议。\n\n' +
      '每条必须满足：\n' +
      '1. ref 原样引用简历里的定位标记（如 E2:B1、E3、S1、SKILLS、INTENT），不得自造；\n' +
      '2. before 与原文该标记处的文字一字不差；\n' +
      '3. after 是可直接替换的改写：动作词更强、结果更具体、与 JD 关键词对齐；原文没有的数据不要编造，需要数据处写「（补：真实数据）」；\n' +
      '4. why 用 1-2 句说明为什么这么改；\n' +
      '5. severity 取 high / mid / low，group 取 文案 / 结构 / 匹配度 / 格式；\n' +
      '6. title 用不超过 30 字说明改什么。\n' +
      '某部分已经很好时不要为凑数给建议。严格只输出 JSON，不要任何其它文字，不要 ``` 包裹：\n' +
      '{"items":[{"ref":"","title":"","before":"","after":"","why":"","severity":"mid","group":"文案"}]}';
  }

  function userPrompt(ser, jdText) {
    var extra = '';
    try {
      var n = (window.App && window.App.state.suggestions || []).length;
      extra = '当前规则诊断已给出 ' + n + ' 条建议；请补它没覆盖的角度（表述力度、量化表达、JD 对齐、结构层次），不要重复它的条目。';
    } catch (e) { extra = ''; }
    return '<resume>\n' + ser.text + '\n</resume>\n\n<jd>\n' + (jdText || '（未提供 JD，按通用规范给建议）') + '\n</jd>\n\n<extra>\n' + extra + '\n</extra>';
  }

  function run() {
    if (busy) return;
    var app = window.App;
    if (!app || !app.state.base) { app.toast('先上传一份简历，再生成 AI 建议'); return; }

    var btn = $('btnAiSuggest');
    if (btn) { btn.disabled = true; btn.textContent = '✦ AI 生成中…'; }
    app.toast('AI 正在通读简历与 JD…');

    var ser = serialize(app.state.base);
    var jdText = app.state.rawJd || '';
    if (jdText.length > 900) jdText = jdText.slice(0, 900) + '…（JD 已截断）';

    var messages = [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: userPrompt(ser, jdText) },
    ];

    window.AI.chatJSON(messages, { maxTokens: 8192 }).then(function (j) {
      var list = (j && j.items) || [];
      if (!Array.isArray(list) || !list.length) throw new Error('模型这次没有给出可用建议，换个问法或重试');
      var added = 0, skipped = 0;

      // 先清掉上一轮 AI 建议，避免重复叠加
      app.state.suggestions = app.state.suggestions.filter(function (s) { return !s.ai; });

      list.slice(0, 8).forEach(function (it, i) {
        var before = String(it.before || ''), after = String(it.after || '');
        if (!before || !after || norm(before) === norm(after)) { skipped++; return; }
        var ref = String(it.ref || '');
        var ok = applyRef(cloneForTest(app.state.base), ser.refs, ref, before, after);
        if (!ok) { skipped++; return; }
        var group = ['文案', '结构', '匹配度', '格式'].indexOf(it.group) >= 0 ? it.group : '文案';
        var sev = ['high', 'mid', 'low'].indexOf(it.severity) >= 0 ? it.severity : 'mid';
        var captured = { ref: ref, after: after, before: before };
        app.state.suggestions.push({
          id: 'ai-' + i + '-' + Date.now().toString(36),
          group: group, severity: sev, order: 200 + i, ai: true,
          title: String(it.title || ('AI 改写：' + ref)),
          why: String(it.why || '大模型改写，采纳前请核对事实。'),
          before: before,
          after: after,
          note: 'AI 生成：只改表述、未编造事实，但采纳前请核对数字与人名。',
          apply: function (m) { applyRef(m, ser.refs, captured.ref, captured.before, captured.after); },
        });
        added++;
      });

      app.state.suggestions.sort(function (a, b) { return a.order - b.order; });
      app.rebuild();
      app.renderSuggestions();
      app.toast('AI 新增 ' + added + ' 条建议' + (skipped ? '，跳过 ' + skipped + ' 条无效/重复项' : ''));
    }).catch(function (e) {
      app.toast((e.message || 'AI 建议生成失败') + '（已保留规则版建议）');
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = '✦ AI 建议'; }
    });
  }

  /** 试算一次 apply，确认这条建议不会崩（不动真模型） */
  function cloneForTest(m) { return JSON.parse(JSON.stringify(m)); }

  window.AIPolish = { run: run };
})();

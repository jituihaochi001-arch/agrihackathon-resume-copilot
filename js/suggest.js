/* suggest.js — 诊断规则与可采纳建议生成 */
(function () {
  'use strict';

  var WEAK_MAP = [
    [/^负责/, '统筹'],
    [/^参与/, '承担'],
    [/^协助/, '协同'],
    [/^帮助/, '推动'],
    [/^配合/, '协同'],
    [/^了解/, '掌握'],
    [/^接触/, '熟悉'],
    [/^支持/, '支撑'],
    [/^跟进/, '推动'],
    [/^完成/, '落地']
  ];

  var MECH = [
    { re: /(数据|报表|看板|指标|口径|分析|埋点|建模)/, add: '，统一口径并建立定期复盘机制' },
    { re: /(实验|测试|评估|复盘|调研|研究|报告|方案)/, add: '，形成可复用的结论与模板' },
    { re: /(活动|用户|内容|社群|投放|渠道|增长|转化|留存)/, add: '，形成可复用的执行流程并跟踪效果' },
    { re: /(团队|项目|部门|预算|排期|协同)/, add: '，推动跨部门协同并按节点交付' },
    { re: /(系统|接口|模块|架构|代码|服务|性能|部署)/, add: '，保障交付质量与线上稳定' },
    { re: /(客户|合同|回款|续约|谈判|招投标)/, add: '，维护长期合作关系并推动签约落地' },
    { re: /(制度|流程|规范|体系|标准|SOP)/, add: '，沉淀为可落地的规范文档' }
  ];

  var CLICHE = /(性格开朗|活泼开朗|开朗大方|吃苦耐劳|学习能力强|责任心强|沟通能力强|团队合作精神|团队协作精神|积极向上|抗压能力强|为人诚恳|踏实肯干|爱好广泛|善于沟通|良好的沟通能力|有较强的责任心)/;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function sec(m, type) {
    for (var i = 0; i < m.sections.length; i++) if (m.sections[i].type === type) return m.sections[i];
    return null;
  }

  function isWork(s) {
    return s.type === 'experience' || s.type === 'project' || s.type === 'campus';
  }

  var VERB_GUARD = /^(负责|参与|协助|帮助|配合|了解|接触|支持|跟进|完成)(向|为|对|跟|与|给)/;

  function swapVerb(b) {
    if (VERB_GUARD.test(b)) return b;
    for (var i = 0; i < WEAK_MAP.length; i++) {
      if (WEAK_MAP[i][0].test(b)) return b.replace(WEAK_MAP[i][0], WEAK_MAP[i][1]);
    }
    return b;
  }

  function newSec(type, heading, en, mode) {
    return { uid: 'x' + Math.random().toString(36).slice(2, 7), type: type, heading: heading, en: en || '', mode: mode || 'entries', items: [], chips: [], text: '' };
  }

  function allEntries(m) {
    var out = [];
    m.sections.forEach(function (s) {
      if (s.mode === 'entries') s.items.forEach(function (it) { out.push({ sec: s, item: it }); });
    });
    return out;
  }

  function trimRole(s) {
    return String(s || '').replace(/(经理|专员|主管|总监|工程师|分析师|设计师|顾问|助理|实习生|负责人)$/, '').trim();
  }

  function short(s, n) {
    s = String(s || '').replace(/[。；;]$/, '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function statedYears(m) {
    // 简历里明写的「N 年…经验」优先于按日期推算，避免把 3 年写成 5 年
    var t = '';
    try { t = window.ResumeModel.toText(m); } catch (e) { t = ''; }
    var mm = t.match(/(\d{1,2}(?:\.\d)?)\s*年(?:以上)?[^\n。；;]{0,10}经验/);
    var n = mm ? parseFloat(mm[1]) : 0;
    return (n > 0 && n < 45) ? n : 0;
  }

  function composeSummary(m, jd) {
    var stated = statedYears(m);
    var years = stated || window.JD.estimateYears(m);
    var entries = allEntries(m).filter(function (e) { return e.sec.type === 'experience' || e.sec.type === 'project'; });
    var latest = entries[0] ? entries[0].item : null;
    var domain = (jd && jd.title) || (latest && latest.role) || '';

    var seg = [];
    if (years >= 1) seg.push('约 ' + Math.round(years) + ' 年' + (domain || '') + '相关经验');
    else if (latest) seg.push((domain || '目标岗位') + '方向实践经验');
    else seg.push('相关专业背景');

    if (latest && latest.org) {
      seg.push('最近任职于' + latest.org + (latest.role ? '，担任' + latest.role : ''));
    }

    // 证据句：优先挑带数字的要点，最多两句（对应「2~3 项核心竞争力 + 证据」）
    var evidence = [];
    entries.slice(0, 2).forEach(function (e) {
      var best = e.item.bullets.slice().sort(function (a, b) {
        return (/\d/.test(b) ? 1 : 0) - (/\d/.test(a) ? 1 : 0) || b.length - a.length;
      })[0];
      if (!best) return;
      var t = short(swapVerb(window.ResumeModel.stripBullet(best)), 42);
      if (t && evidence.join('').indexOf(t.slice(0, 8)) < 0) evidence.push(t);
    });

    var text = seg.join('，') + '。';
    if (evidence.length) text += evidence[0] + '。';

    var kws = [];
    if (jd && jd.keywords) {
      var body = window.ResumeModel.toText(m);
      kws = jd.keywords.filter(function (k) { return window.JD.has(body, k.k); }).slice(0, 3).map(function (k) { return k.k; });
    }
    if (!kws.length) {
      var ss = sec(m, 'skills');
      if (ss) kws = ss.chips.slice(0, 3).map(function (c) { return c.split(/[：:]/).pop().trim(); });
    }
    if (kws.length) text += '熟悉' + kws.join('、') + '。';
    if (evidence[1]) text += evidence[1] + '。';

    // 抬头已经显示了求职意向，简介里再写一遍是重复；只有简历没写意向时才补
    var intent = (jd && jd.title) || m.intent;
    if (intent && !m.intent) text += '求职意向：' + intent + '。';

    if (text.length < 60) text += '可快速承接岗位核心职责，适应业务节奏。';
    return text;
  }

  function bridgeClause(kw) {
    if (/数据|指标|报表|分析|建模/.test(kw)) return '，相关方法可迁移至' + kw + '与复盘场景';
    if (/增长|运营|转化|留存|拉新|投放/.test(kw)) return '，相关能力可迁移至' + kw + '相关工作';
    if (/管理|项目|协同/.test(kw)) return '，可支撑' + kw + '类事项推进';
    if (/客户|销售|商务/.test(kw)) return '，可迁移至' + kw + '相关的沟通与交付场景';
    if (/设计|体验|交互/.test(kw)) return '，可支撑' + kw + '相关的方案输出';
    return '，相关能力可迁移至' + kw + '相关工作';
  }

  function build(model, jd) {
    var items = [];
    var gaps = [];
    var q = window.JD.analyzeQuality(model);
    var body = window.ResumeModel.toText(model);

    // ---------- 1. 个人简介缺失 ----------
    var summarySec = sec(model, 'summary');
    var summaryText = summarySec ? (summarySec.text || '') : '';
    if (summaryText.replace(/\s/g, '').length < 20) {
      var composed = composeSummary(model, jd);
      items.push({
        id: 'summary-add', group: '匹配度', severity: 'high', order: 10,
        title: '缺少个人简介，招聘方前 8 秒看不到你的定位',
        why: '简历最上方通常是被阅读的第一段。用「年限 + 领域 + 一条硬证据 + 求职意向」的结构，让筛选者在 10 秒内判断你是否对口。',
        before: summaryText || '（当前没有个人简介板块）',
        after: composed,
        apply: function (m) {
          var s = sec(m, 'summary');
          if (!s) { s = newSec('summary', '个人简介', 'PROFILE', 'para'); s.uid = 'sum'; m.sections.unshift(s); }
          s.mode = 'para';
          s.text = composed;
        }
      });
    } else if (CLICHE.test(summaryText)) {
      var kept = summaryText.split(/[。；;]/).map(function (s) { return s.trim(); })
        .filter(function (s) { return s && !CLICHE.test(s); }).join('。');
      var rebuilt = (kept.length > 40 ? kept + '。' : '') + composeSummary(model, jd);
      items.push({
        id: 'summary-cliche', group: '文案', severity: 'mid', order: 11,
        title: '个人简介里的形容词，替换成可验证的事实',
        why: '「性格开朗、吃苦耐劳、责任心强」这类自评无法被验证，也不含岗位信息，通常被直接跳过。改为年限、领域与具体成果。',
        before: summaryText,
        after: rebuilt,
        apply: function (m) {
          var s = sec(m, 'summary');
          if (!s) { s = newSec('summary', '个人简介', 'PROFILE', 'para'); s.uid = 'sum'; m.sections.unshift(s); }
          s.mode = 'para';
          s.text = rebuilt;
        }
      });
    }

    // ---------- 1.5 个人简介偏短（规范要求 100~180 字） ----------
    var summaryLen = summaryText.replace(/\s/g, '').length;
    if (summaryLen >= 20 && summaryLen < 90 && !CLICHE.test(summaryText)) {
      var richer = composeSummary(model, jd);
      if (richer.length > summaryText.length + 20) {
        items.push({
          id: 'summary-short', group: '匹配度', severity: 'mid', order: 12,
          title: '个人简介只有 ' + summaryLen + ' 字，撑不起「定位 + 证据 + 意向」',
          why: '规范的简介是 100~180 字的三句话：第一句定位（年限 + 领域），中间一句给一条可验证的成果，最后一句写求职意向。太短等于放弃开头的黄金版面。',
          before: summaryText,
          after: richer,
          apply: function (m) {
            var s = sec(m, 'summary');
            if (!s) return;
            s.mode = 'para';
            s.text = richer;
          }
        });
      }
    }

    // ---------- 2. 弱动词 ----------
    allEntries(model).forEach(function (pair, pi) {
      if (!isWork(pair.sec)) return;
      var it = pair.item;
      var targets = it.bullets.filter(function (b) {
        return /^(负责|参与|协助|帮助|配合|了解|接触|支持|跟进|完成)/.test(b) && !VERB_GUARD.test(b);
      });
      if (!targets.length) return;
      var before = targets.join('\n');
      var afterArr = targets.map(swapVerb);
      items.push({
        id: 'verb-' + it.uid, group: '文案', severity: targets.length >= 2 ? 'high' : 'mid', order: 20 + pi,
        title: (it.org || '该段经历') + '：' + targets.length + ' 条要点以「负责／参与」开头，动作强度偏弱',
        why: '「负责」只说明职责归属，「统筹／搭建／推动」才说明你的介入深度。动词是招聘方判断职级的第一条线索。',
        before: before,
        after: afterArr.join('\n'),
        apply: function (m) {
          var e = findItem(m, it.uid);
          if (!e) return;
          e.bullets = e.bullets.map(swapVerb);
        }
      });
    });

    // ---------- 3. 量化 / 结果导向 ----------
    allEntries(model).forEach(function (pair, pi) {
      if (!isWork(pair.sec)) return;
      var it = pair.item;
      if (!it.bullets.length) return;
      var quantified = it.bullets.filter(function (b) { return /\d/.test(b) && /(%|％|倍|万|亿|个|家|人|次|天|小时|元|条|篇|场|款|项|位)/.test(b); }).length;
      if (quantified / it.bullets.length >= 0.5) return;

      var pool = it.bullets.filter(function (b) {
        return b.length <= 96 && !/(形成|统一口径|沉淀|保障|建立|推动跨部门|维护长期)/.test(b);
      });
      var target = pool.slice().sort(function (a, b) { return a.length - b.length; })[0];
      if (!target) return;
      var targetIdx = it.bullets.indexOf(target);

      var mech = MECH.filter(function (x) { return x.re.test(target); })[0];
      var add = mech ? mech.add : '，推动事项按计划落地';
      var base = swapVerb(target);
      var after = base.replace(/[。；;]$/, '') + add;
      if (after === target || after === base) return;

      items.push({
        id: 'quant-' + it.uid, group: '文案', severity: 'high', order: 30 + pi,
        title: (it.org || '该段经历') + '：要点停留在「做了什么」，缺少「做到什么程度」',
        why: '这一段没有出现任何数字。先补齐「动作 + 机制 + 结果」的骨架，再把真实数据填进去，比空写职责有说服力得多。',
        before: target,
        after: after,
        note: '采纳后仍建议补上真实数据（规模 / 增幅 / 周期 / 人数），系统不会替你编造。',
        apply: function (m) {
          var e = findItem(m, it.uid);
          if (!e) return;
          var idx = targetIdx;
          if (idx >= e.bullets.length || idx < 0) return;
          var cur = e.bullets[idx];
          // 位置可能已被动词替换改写，按首段关键词核对，避免误伤其它要点
          if (cur !== target) {
            var head = target.slice(0, 6).replace(/^(负责|参与|协助|帮助|配合|了解|接触|支持|跟进|完成)/, '');
            if (cur.indexOf(head) < 0) {
              var found = -1;
              for (var i = 0; i < e.bullets.length; i++) { if (e.bullets[i].indexOf(head) >= 0) { found = i; break; } }
              if (found < 0) return;
              idx = found;
            }
          }
          var baseCur = swapVerb(e.bullets[idx]);
          e.bullets[idx] = baseCur.replace(/[。；;]$/, '') + add;
        }
      });
    });

    // ---------- 4. JD 对齐（换角度阐述） ----------
    if (jd && jd.keywords.length) {
      var top = jd.keywords.slice(0, 8);
      allEntries(model).forEach(function (pair, pi) {
        if (pair.sec.type !== 'experience' && pair.sec.type !== 'project') return;
        var it = pair.item;
        if (!it.bullets.length) return;
        var joined = it.bullets.join(' ');
        var isIntern = /实习|Intern/i.test((it.org || '') + (it.role || ''));
        if (isIntern) return;
        var hit = top.filter(function (k) { return window.JD.has(joined, k.k); });
        if (hit.length) return;

        var kw = top[Math.min(pi + 1, top.length - 1)];
        if (!kw) return;
        var lastIdx = it.bullets.length - 1;
        var target = it.bullets[lastIdx];
        if (target.length > 88) return;
        var after = target.replace(/[。；;]$/, '') + bridgeClause(kw.k);

        items.push({
          id: 'bridge-' + it.uid, group: '匹配度', severity: 'mid', order: 40 + pi,
          title: (it.org || '该段经历') + '：与 JD 的核心词「' + kw.k + '」没有交集',
          why: '同一段事实可以换一个落点讲：保留真实动作，把结论指向目标岗位关心的价值。这是「换角度阐述」，不改变任何事实。',
          before: target,
          after: after,
          note: '请确认改写后的落点与你的实际工作内容相符。',
          apply: function (m) {
            var e = findItem(m, it.uid);
            if (!e || !e.bullets.length) return;
            var k = e.bullets.length - 1;
            if (e.bullets[k].length > 88) return;
            e.bullets[k] = e.bullets[k].replace(/[。；;]$/, '') + bridgeClause(kw.k);
          }
        });
      });
    }

    // ---------- 5. 技能补缺（需确认） ----------
    if (jd && jd.keywords.length) {
      var must = jd.keywords.filter(function (k) { return k.must && !window.JD.has(body, k.k); }).slice(0, 5);
      if (must.length >= 2) {
        var names = must.map(function (k) { return k.k; });
        items.push({
          id: 'skill-add', group: '匹配度', severity: 'high', order: 50, confirm: true,
          title: 'JD 明确要求的 ' + names.length + ' 项能力，简历中完全没有出现',
          why: '关键词缺失会被系统筛掉，也会让人工筛选者认为你不具备。若你确实掌握，请补充到技能区；不掌握就不要采纳。',
          before: '（简历中未出现：' + names.join('、') + '）',
          after: '技能区追加：' + names.join('、'),
          note: '此条可能涉及事实，请务必确认自己确实具备后再采纳。',
          apply: function (m) {
            var s = sec(m, 'skills');
            if (!s) { s = newSec('skills', '专业技能', 'SKILLS', 'chips'); m.sections.push(s); }
            names.forEach(function (n) {
              if (s.chips.indexOf(n) < 0) s.chips.push(n);
            });
          }
        });
      }
    }

    // ---------- 6. 技能排序 ----------
    var skillSec = sec(model, 'skills');
    if (skillSec && skillSec.chips.length >= 3 && jd && jd.keywords.length) {
      var order = skillSec.chips.map(function (c, i) {
        var score = 0;
        jd.keywords.forEach(function (k) { if (window.JD.has(c, k.k)) score += k.w; });
        return { c: c, i: i, s: score };
      });
      var sorted = order.slice().sort(function (a, b) { return b.s - a.s || a.i - b.i; });
      var changed = sorted.some(function (x, i) { return x.i !== i; });
      if (changed && sorted[0].s > 0) {
        var afterOrder = sorted.map(function (x) { return x.c; });
        items.push({
          id: 'skill-order', group: '结构', severity: 'low', order: 60,
          title: '技能区按 JD 相关度重排，把最对口的放在最前',
          why: '技能区通常被扫读而非精读，前 3 项决定了「你像不像这个岗位的人」。',
          before: skillSec.chips.join(' · '),
          after: afterOrder.join(' · '),
          apply: function (m) {
            var s = sec(m, 'skills');
            if (!s) return;
            s.chips = afterOrder.filter(function (c) { return s.chips.indexOf(c) >= 0; })
              .concat(s.chips.filter(function (c) { return afterOrder.indexOf(c) < 0; }));
          }
        });
      }
    }

    // ---------- 7. 章节顺序 ----------
    var idxEdu = model.sections.findIndex(function (s) { return s.type === 'education'; });
    var idxExp = model.sections.findIndex(function (s) { return s.type === 'experience'; });
    if (idxEdu >= 0 && idxExp >= 0 && idxEdu < idxExp) {
      var years = window.JD.estimateYears(model);
      if (years >= 1) {
        items.push({
          id: 'order-sec', group: '结构', severity: 'mid', order: 70,
          title: '已有 ' + Math.round(years) + ' 年工作经验，教育背景却排在工作经历之前',
          why: '有经验者应把工作经历放在靠上的位置——那是招聘方最关心的部分；教育背景下移后仍然完整保留。',
          before: '教育背景 → 工作经历',
          after: '工作经历 → 项目经历 → 教育背景',
          apply: function (m) {
            var rank = { summary: 0, experience: 1, project: 2, campus: 3, education: 4, skills: 5, awards: 6, language: 7, other: 8 };
            m.sections = m.sections.map(function (s, i) { return { s: s, i: i }; })
              .sort(function (a, b) {
                var ra = rank[a.s.type] === undefined ? 9 : rank[a.s.type];
                var rb = rank[b.s.type] === undefined ? 9 : rank[b.s.type];
                return ra - rb || a.i - b.i;
              })
              .map(function (x) { return x.s; });
          }
        });
      }
    }

    // ---------- 8. 日期格式 ----------
    var badDates = [];
    allEntries(model).forEach(function (p) {
      var meta = p.item.meta;
      if (meta && !/^\d{4}\.\d{2}\s-\s(\d{4}\.\d{2}|至今)$/.test(meta)) badDates.push(meta);
    });
    if (badDates.length) {
      items.push({
        id: 'date-fmt', group: '格式', severity: 'low', order: 80,
        title: badDates.length + ' 处时间格式不统一',
        why: '统一为「YYYY.MM - YYYY.MM」后，时间线更容易被快速扫读，也避免了「2019-2021」与「2019.3-2021.5」混用带来的歧义。',
        before: badDates.slice(0, 3).join(' / '),
        after: badDates.slice(0, 3).map(function (d) { return window.ResumeModel.normRange(d) || d; }).join(' / '),
        apply: function (m) {
          allEntries(m).forEach(function (p) {
            if (p.item.meta) {
              var n = window.ResumeModel.normRange(p.item.meta);
              if (n) p.item.meta = n;
            }
          });
        }
      });
    }

    // ---------- 9. 过长要点 ----------
    allEntries(model).forEach(function (pair, pi) {
      var it = pair.item;
      var longOnes = it.bullets.filter(function (b) { return b.length > 88; });
      if (!longOnes.length) return;
      var t = longOnes[0];
      var tIdx = it.bullets.indexOf(t);
      var cut = t.indexOf('；') > 20 ? t.indexOf('；') : t.indexOf('，其中');
      if (cut < 20) cut = Math.floor(t.length / 2);
      var after = t.slice(0, cut).replace(/[，、]$/, '') + '\n' + t.slice(cut + 1);
      items.push({
        id: 'split-' + it.uid, group: '格式', severity: 'low', order: 90 + pi,
        title: (it.org || '该段经历') + '：有 ' + longOnes.length + ' 条要点超过 88 字',
        why: '一条要点承载多个信息时，筛选者会整条略过。拆成两条独立要点，信息密度不变，可读性明显提升。',
        before: t,
        after: after,
        apply: function (m) {
          var e = findItem(m, it.uid);
          if (!e || tIdx >= e.bullets.length) return;
          var cur = e.bullets[tIdx];
          var cut2 = cur.indexOf('；') > 20 ? cur.indexOf('；') : Math.floor(cur.length / 2);
          if (cur.length <= 40) return;
          var a = cur.slice(0, cut2).replace(/[，、；]$/, '');
          var b = cur.slice(cut2 + 1).replace(/^[，、；]/, '');
          if (!a || !b) return;
          e.bullets.splice(tIdx, 1, a, b);
        }
      });
    });

    // ---------- 10. 重复要点 ----------
    allEntries(model).forEach(function (pair, pi) {
      var it = pair.item;
      if (it.bullets.length < 2) return;
      var norm = function (s) { return s.replace(/[\s\d\p{P}]/gu, ''); };
      for (var i = 0; i < it.bullets.length; i++) {
        for (var j = i + 1; j < it.bullets.length; j++) {
          var a = norm(it.bullets[i]), b = norm(it.bullets[j]);
          if (!a || !b) continue;
          var isDup = a === b || (a.indexOf(b) >= 0 && b.length / a.length > 0.8) || (b.indexOf(a) >= 0 && a.length / b.length > 0.8);
          if (!isDup) continue;
          var dupIndex = b.length <= a.length ? j : i;
          var dupText = it.bullets[dupIndex];
          items.push({
            id: 'dup-' + it.uid + '-' + dupIndex, group: '结构', severity: 'low', order: 100 + pi,
            title: (it.org || '该段经历') + '：有两条要点表达重复',
            why: '重复的内容占用篇幅却不增加信息，删掉更短的那条即可。',
            before: dupText,
            after: '（删除该条）',
            apply: function (m) {
              var e = findItem(m, it.uid);
              if (!e) return;
              var k = e.bullets.indexOf(dupText);
              if (k >= 0 && e.bullets.length > 1) e.bullets.splice(k, 1);
            }
          });
          return;
        }
      }
    });

    // ---------- 11. 篇幅 ----------
    var chars = window.ResumeModel.charCount(model);
    if (chars > 2000) {
      var entries = allEntries(model).filter(function (p) { return p.sec.type === 'experience' || p.sec.type === 'project'; });
      if (entries.length >= 2) {
        var weakest = entries[entries.length - 1];
        if (weakest.item.bullets.length >= 2) {
          items.push({
            id: 'trim-len', group: '结构', severity: 'low', order: 110,
            title: '全文约 ' + chars + ' 字，已超过一页半的舒适阅读量',
            why: '非核心经历保留 1 条要点即可腾出空间。早期经历的细节越多，越会稀释最近一段经历的权重。',
            before: weakest.item.bullets.join('\n'),
            after: weakest.item.bullets[0] + '（其余 ' + (weakest.item.bullets.length - 1) + ' 条精简）',
            apply: function (m) {
              var list = allEntries(m).filter(function (p) { return p.sec.type === 'experience' || p.sec.type === 'project'; });
              var w = list[list.length - 1];
              if (w && w.item.bullets.length > 1) w.item.bullets = [w.item.bullets[0]];
            }
          });
        }
      }
    }

    // ---------- 12. 求职意向 ----------
    if (!model.intent && jd && jd.title) {
      items.push({
        id: 'intent-add', group: '格式', severity: 'mid', order: 120,
        title: '抬头没有写求职意向',
        why: 'HR 需要一眼确认你投的是什么岗。把 JD 的岗位名写在姓名下方，可以避免被误分流到其他岗位。',
        before: '（未填写）',
        after: '求职意向：' + jd.title,
        apply: function (m) { m.intent = jd.title; }
      });
    }

    // ---------- 13. 第一人称 ----------
    var firstPerson = [];
    allEntries(model).forEach(function (p) {
      p.item.bullets.forEach(function (b) { if (/^(我|本人)/.test(b) || /我的/.test(b)) firstPerson.push(b); });
    });
    if (firstPerson.length) {
      items.push({
        id: 'first-person', group: '文案', severity: 'low', order: 130,
        title: '简历中出现第一人称表述',
        why: '简历的默认主语就是「我」，写出「我」反而显得口语化。删掉后语句更利落。',
        before: firstPerson[0],
        after: firstPerson[0].replace(/^(我|本人)\s*/, '').replace(/我的/g, ''),
        apply: function (m) {
          allEntries(m).forEach(function (p) {
            p.item.bullets = p.item.bullets.map(function (b) {
              return b.replace(/^(我|本人)\s*/, '').replace(/我的/g, '');
            });
          });
        }
      });
    }

    // ================= 待补充项（不自动修改） =================
    if (!model.contact.some(function (c) { return c.label === '电话'; })) {
      gaps.push({ t: '缺少手机号', d: '抬头区未识别到 11 位手机号，ATS 与 HR 都无法联系你。' });
    }
    if (!model.contact.some(function (c) { return c.label === '邮箱'; })) {
      gaps.push({ t: '缺少邮箱', d: '建议使用「姓名拼音 + 数字」的正式邮箱，不要用昵称邮箱。' });
    }
    if (!model.contact.some(function (c) { return c.label === '城市'; })) {
      gaps.push({ t: '未写明所在城市', d: '异地投递时，城市信息是筛选条件之一，建议补上。' });
    }
    if (!sec(model, 'education')) {
      gaps.push({ t: '未识别到教育背景', d: '若确有学历，请补一节「教育背景：学校 / 专业 / 学历 / 时间」。' });
    }
    if (model.unstructured) {
      gaps.push({ t: '未能识别章节标题', d: '当前内容缺少「教育背景」「工作经历」等小标题。建议按板块改名后重新粘贴，诊断会更准确。' });
    }
    if (jd && jd.yearReq && window.JD.estimateYears(model) && window.JD.estimateYears(model) < jd.yearReq) {
      gaps.push({ t: '工作年限低于 JD 要求', d: 'JD 要求 ' + jd.yearReq + ' 年，简历约 ' + window.JD.estimateYears(model) + ' 年。可通过突出项目跨度、实习与兼职经历补足，但不要改写年份。' });
    }
    if (q.count && q.quantifiedRatio < 0.2) {
      gaps.push({ t: '全篇仅 ' + Math.round(q.quantifiedRatio * 100) + '% 的要点含数据', d: '建议至少为核心经历的每条要点补一个数字：规模、增幅、周期、人数或金额。' });
    }

    // 每条经历 3~6 条要点（规范上限），超出的一页简历必然超页
    allEntries(model).forEach(function (p) {
      if (!isWork(p.sec)) return;
      var n = p.item.bullets.length;
      if (n > 6) {
        gaps.push({
          t: (p.item.org || '某段经历') + '有 ' + n + ' 条要点，超过 6 条上限',
          d: '一页简历里每段经历保留 3~6 条即可。优先删掉与 JD 无关、且没有数字支撑的条目。'
        });
      }
    });

    items.sort(function (a, b) { return a.order - b.order; });
    return { items: items, gaps: gaps };
  }

  function findItem(m, uid) {
    for (var i = 0; i < m.sections.length; i++) {
      var items = m.sections[i].items;
      for (var j = 0; j < items.length; j++) if (items[j].uid === uid) return items[j];
    }
    return null;
  }

  window.Suggest = { build: build, clone: clone };
})();

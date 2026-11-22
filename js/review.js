/* review.js — 面试总结（错题本）：把模拟面试里没答上来的题收起来，附参考答案 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'rp-interview-review-v1';
  var MAX = 200;

  var filter = 'todo';   // todo | done | all

  /* ---------------- 存储 ---------------- */

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(v) ? v.filter(function (x) { return x && x.q; }) : [];
    } catch (e) { return []; }
  }

  function write(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function norm(q) {
    return String(q || '').replace(/[\s\u3000，。？！、：；,.?!:;（）()【】\[\]"'“”‘’·—\-]/g, '').toLowerCase();
  }

  function dayLabel(ts) {
    try {
      var d = new Date(ts || Date.now());
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    } catch (e) { return ''; }
  }

  function newId() {
    return 'rv_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  /* ---------------- 收集：报告里判定为「没答好」的题 ---------------- */

  var WEAK_WORDS = /跳过|未答|没有回答|无回答|不会|答不上|空白/;

  /** 在报告条目里按题目文本找对应的那一轮对话（模型可能漏题或换措辞） */
  function logOf(log, q, used) {
    var key = norm(q);
    for (var i = 0; i < log.length; i++) {
      if (used[i]) continue;
      if (norm(log[i].q) === key) { used[i] = true; return log[i]; }
    }
    return null;
  }

  function collect(report, ctx) {
    ctx = ctx || {};
    var items = (report && report.items) || [];
    var log = ctx.log || [];
    var used = Object.create(null);
    var list = read();
    var added = 0;

    function put(it, row) {
      var q = String((it && it.q) || (row && row.q) || '').trim();
      if (!q) return;

      var ans = String((it && it.a) || '');
      var skipped = !!(row && (row.skipped || row.a === null));
      var score = it && typeof it.score === 'number' ? it.score : null;
      var weak = (it && (it.weak === true || it.weak === 1 || it.weak === 'true')) ||
        skipped || WEAK_WORDS.test(ans) || (score !== null && score < 60);
      if (!weak) return;

      var key = norm(q);
      var hit = null;
      for (var k = 0; k < list.length; k++) {
        if (norm(list[k].q) === key) { hit = list[k]; break; }
      }

      var ref = String((it && it.reference) || (hit && hit.ref) || '');
      var issue = String((it && it.issue) || (hit && hit.issue) || '');
      var strength = String((it && it.strength) || (hit && hit.strength) || '');

      if (hit) {
        // 同一个问题再错一次：更新参考答案，重新回到「待复习」
        hit.ref = ref;
        hit.issue = issue;
        hit.strength = strength;
        hit.role = ctx.role || hit.role || '';
        hit.round = ctx.round || hit.round || '';
        hit.resume = ctx.resume || hit.resume || '';
        hit.at = Date.now();
        hit.seen = (hit.seen || 1) + 1;
        hit.done = false;
      } else {
        list.unshift({
          id: newId(),
          q: q,
          ref: ref,
          issue: issue,
          strength: strength,
          role: ctx.role || '',
          round: ctx.round || '',
          level: ctx.level || '',
          resume: ctx.resume || '',
          at: Date.now(),
          seen: 1,
          done: false
        });
        added++;
      }
    }

    items.forEach(function (it) {
      if (!it) return;
      var q = String(it.q || '').trim();
      var row = q ? logOf(log, q, used) : null;
      if (!q && row) it = { q: row.q, a: row.a }; // 模型没给题目时用原题兜底
      put(it, row);
    });

    // 报告里被漏掉的「跳过 / 没答」题也要收进来，不能因为没有评分就丢掉
    log.forEach(function (row, i) {
      if (used[i] || !row || !row.q) return;
      if (row.a === null || row.skipped) put(null, row);
    });

    while (list.length > MAX) list.pop();
    write(list);
    syncBadge();
    return { added: added, total: list.filter(function (x) { return !x.done; }).length };
  }

  /* ---------------- 补齐参考答案（错题本里少数题目报告没给参考） ---------------- */

  var filling = false;

  function aiReady() {
    try { return !!(window.AI && window.AI.get && window.AI.get().hasKey); } catch (e) { return false; }
  }

  function fillRefs(ids) {
    if (filling) return;
    var list = read();
    var todo = list.filter(function (x) {
      return !x.ref && (!ids || ids.indexOf(x.id) >= 0);
    });
    if (!todo.length) return;
    if (!aiReady()) {
      window.App && window.App.toast && window.App.toast('先到「API 设置」配置 Key，才能自动生成参考答案');
      return;
    }

    filling = true;
    var batch = todo.slice(0, 8);
    Array.prototype.forEach.call(document.querySelectorAll('.rv-card'), function (li) {
      if (!todo.some(function (x) { return x.id === li.dataset.rid; })) return;
      var b = li.querySelector('[data-act="gen"]');
      if (b) { b.disabled = true; b.textContent = '生成中…'; }
    });

    window.AI.chatJSON([
      {
        role: 'system',
        content: '你是资深面试官兼面试教练。根据题目给出可以直接照着练的参考答案，只输出 JSON，不要任何其它文字。\n' +
          '每题答案 80-140 字，结构清楚：先给结论/框架，再给 2-3 个要点，最后落到一个可量化的结果；不要编造具体公司名，用「我上一份工作」这类表述。\n' +
          '输出结构：{"answers":[{"id":"","q":"","answer":""}]}'
      },
      {
        role: 'user',
        content: '岗位：' + (batch[0].role || '未指定') + '　轮次：' + (batch[0].round || '未指定') + '\n' +
          '请给下面这些题写参考答案：\n' +
          batch.map(function (x, i) {
            return (i + 1) + '. [id=' + x.id + '] ' + x.q;
          }).join('\n')
      }
    ], { maxTokens: 1800 }).then(function (j) {
      var map = Object.create(null);
      ((j && j.answers) || []).forEach(function (a) {
        if (!a) return;
        if (a.id) map[a.id] = a.answer;
        else if (a.q) {
          var k = norm(a.q);
          batch.forEach(function (x) { if (norm(x.q) === k) map[x.id] = a.answer; });
        }
      });
      var l = read();
      var n = 0;
      l.forEach(function (x) {
        if (map[x.id] && !x.ref) { x.ref = String(map[x.id]); n++; }
      });
      write(l);
      render();
      if (n) window.App && window.App.toast && window.App.toast('已补齐 ' + n + ' 道参考答案');
      else window.App && window.App.toast && window.App.toast('这次没有拿到参考答案，可以稍后再试');
    }).catch(function (e) {
      window.App && window.App.toast && window.App.toast((e && e.message) || '生成参考答案失败，请重试');
      render();
    }).then(function () { filling = false; });
  }

  /* ---------------- 统计 / 徽标 ---------------- */

  function counts() {
    var list = read();
    var todo = 0;
    list.forEach(function (x) { if (!x.done) todo++; });
    return { todo: todo, done: list.length - todo, all: list.length };
  }

  function syncBadge() {
    var b = $('rvBadge');
    if (!b) return;
    var n = counts().todo;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
    b.title = n ? ('还有 ' + n + ' 道题待复习') : '';
  }

  /* ---------------- 渲染 ---------------- */

  function card(x, i) {
    var tags = [];
    if (x.role) tags.push('<span>' + esc(x.role) + '</span>');
    if (x.round) tags.push('<span>' + esc(x.round) + '</span>');
    if (x.resume) tags.push('<span>' + esc(x.resume) + '</span>');
    tags.push('<span>' + dayLabel(x.at) + '</span>');
    if (x.seen > 1) tags.push('<span class="rv-seen">错过 ' + x.seen + ' 次</span>');

    var ans = x.ref ?
      esc(x.ref) :
      '这道题当时没有生成参考答案。点右侧「AI 生成参考答案」，或先自己按「做法 + 结果 + 数字」说一遍。';

    var gen = x.ref ? '' :
      '<button class="line-btn small" type="button" data-act="gen">AI 生成参考答案</button>';

    return '<li class="rv-card' + (x.done ? ' is-done' : '') + '" data-rid="' + x.id + '">' +
      '<div class="rv-card-top">' +
        '<span class="rv-no">Q' + ('0' + (i + 1)).slice(-2) + '</span>' +
        '<p class="rv-q">' + esc(x.q) + '</p>' +
        '<span class="rv-state">' + (x.done ? '已掌握' : '待复习') + '</span>' +
      '</div>' +
      '<div class="rv-meta">' + tags.join('') + '</div>' +
      '<div class="rv-acts">' +
        '<button class="line-btn small" type="button" data-act="show" aria-expanded="false">查看参考答案</button>' +
        gen +
        '<button class="text-btn" type="button" data-act="done">' + (x.done ? '标记为待复习' : '标记已掌握') + '</button>' +
        '<button class="text-btn is-danger" type="button" data-act="del">移除</button>' +
      '</div>' +
      '<div class="rv-answer" hidden>' +
        '<div class="rv-ans-main"><span class="lbl">参考答案</span><p>' + ans + '</p></div>' +
      '</div>' +
    '</li>';
  }

  function render() {
    syncBadge();
    var list = read();
    var c = counts();

    var stats = $('rvStats');
    if (stats) {
      stats.innerHTML =
        '<span class="rv-stat"><b>' + c.todo + '</b> 道待复习</span>' +
        '<span class="rv-stat"><b>' + c.done + '</b> 道已掌握</span>' +
        '<span class="rv-stat rv-stat-muted">共 ' + c.all + ' 道</span>';
    }

    var shown = list.filter(function (x) {
      if (filter === 'todo') return !x.done;
      if (filter === 'done') return !!x.done;
      return true;
    });

    var box = $('rvList');
    if (box) box.innerHTML = shown.map(card).join('');

    var empty = $('rvEmpty');
    if (empty) {
      empty.hidden = shown.length > 0;
      if (!shown.length) {
        var t = '还没有需要复习的题目';
        var p = '完成一场模拟面试后，跳过或答得不好的题会自动出现在这里，并附上参考答案。';
        if (c.all && filter === 'todo') {
          t = '待复习的题已经清空';
          p = '全部题目都标记为已掌握了。可以切到「已掌握」回看，或再开一场模拟面试。';
        } else if (c.all && filter === 'done') {
          t = '还没有标记已掌握的题';
          p = '在「待复习」里点「标记已掌握」，题目就会移到这里。';
        } else if (!c.all) {
          t = '错题本还是空的';
        }
        if ($('rvEmptyTitle')) $('rvEmptyTitle').textContent = t;
        if ($('rvEmptyText')) $('rvEmptyText').textContent = p;
      }
    }

    var clear = $('rvClearDone');
    if (clear) clear.hidden = !c.done;

    // 个别题目报告里没给参考答案：用户配了 Key 时自动补齐一次
    var view = $('viewReview');
    if (!filling && view && view.classList.contains('is-active') && aiReady()) {
      var miss = list.filter(function (x) { return !x.ref && !x.done; });
      if (miss.length) setTimeout(function () { fillRefs(); }, 350);
    }
  }

  /* ---------------- 操作 ---------------- */

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function setDone(id, done) {
    var list = read();
    var x = find(list, id);
    if (!x) return;
    x.done = done;
    write(list);
    render();
    window.App && window.App.toast && window.App.toast(done ? '已标记为掌握' : '已放回待复习');
  }

  function remove(id) {
    var list = read().filter(function (x) { return x.id !== id; });
    write(list);
    render();
    window.App && window.App.toast && window.App.toast('已从错题本移除');
  }

  function clearDone() {
    var list = read();
    var rest = list.filter(function (x) { return !x.done; });
    if (rest.length === list.length) return;
    write(rest);
    render();
    window.App && window.App.toast && window.App.toast('已清除 ' + (list.length - rest.length) + ' 道已掌握的题');
  }

  function toggleAnswer(li, btn) {
    var box = li.querySelector('.rv-answer');
    if (!box) return;
    var open = box.hidden;
    box.hidden = !open;
    btn.textContent = open ? '收起参考答案' : '查看参考答案';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /* ---------------- 事件绑定 ---------------- */

  function bind() {
    var list = $('rvList');
    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act]');
        if (!btn) return;
        var li = btn.closest('.rv-card');
        if (!li) return;
        var id = li.dataset.rid;
        var act = btn.dataset.act;
        if (act === 'show') { toggleAnswer(li, btn); return; }
        if (act === 'gen') { fillRefs([id]); return; }
        if (act === 'done') {
          var list2 = read();
          var x = find(list2, id);
          setDone(id, !(x && x.done));
          return;
        }
        if (act === 'del') remove(id);
      });
    }

    var chips = $('rvFilter');
    if (chips) {
      chips.addEventListener('click', function (e) {
        var b = e.target.closest('[data-rv]');
        if (!b) return;
        filter = b.dataset.rv;
        Array.prototype.forEach.call(chips.querySelectorAll('[data-rv]'), function (x) {
          var on = x === b;
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        render();
      });
    }

    var clear = $('rvClearDone');
    if (clear) clear.addEventListener('click', clearDone);

    var goIv = $('rvEmptyStart');
    if (goIv) goIv.addEventListener('click', function () {
      if (window.App && window.App.showInterview) window.App.showInterview();
    });

    // 别的标签页 / 浏览器窗口里清过数据时，回到本页同步一下
    window.addEventListener('focus', function () { if ($('viewReview') && $('viewReview').classList.contains('is-active')) render(); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    bind();
    syncBadge();
    render();
  });

  window.InterviewReview = {
    collect: collect,
    render: render,
    counts: counts,
    syncBadge: syncBadge
  };
})();
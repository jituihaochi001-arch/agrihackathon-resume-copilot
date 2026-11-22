/* paintdoc.js — 绘制原语 × 文字改写 → 最终渲染规格
 *
 * 「保留原版式」的语义只有一条：**只改文字，不动排版**。
 * 所以这里做的事很单纯：
 *   ① 把各页的文字段拼成一条「文字流」，并记下每个字符在原文档里的位置；
 *   ② 把「原文 → 改后」的差异（ops）落到这条流上，定位到具体的文字段；
 *   ③ 没被改动的文字段原样保留（位置、字号、颜色、多列并排全部不变）；
 *      被改动的整段，用**第一段的样式**在**第一段的位置**重画，
 *      段落原本占几行就还占几行（行距照抄原来的）。
 */
(function (root) {
  'use strict';

  var WS = /[\s\u00a0\u3000]/;
  var BULLET_RE = /^[·•▪◦※*+\-–—]+/;

  function normKey(s) {
    return String(s == null ? '' : s)
      .replace(/[\s\u00a0\u3000]/g, '')
      .replace(BULLET_RE, '');
  }

  /** 估算一段文字的宽度（pt）：中文 1em，西文按字符类别折算 */
  function estWidth(s, size) {
    var str = String(s == null ? '' : s);
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c > 0x2e80 && c < 0xa4d0) w += 1;
      else if (c === 32) w += 0.3;
      else if (c >= 48 && c <= 57) w += 0.56;
      else if (c >= 65 && c <= 90) w += 0.7;
      else if (c >= 97 && c <= 122) w += 0.53;
      else w += 0.36;
    }
    return w * size;
  }

  /* ---------------- 多页 → 一页 ---------------- */

  function elTop(e) {
    if (e.size != null) return e.y - e.size * 0.90;      // 文字段：y 是基线
    if (e.yTop != null) return e.yTop;                    // 图片
    if (e.y1 != null) return Math.min(e.y1, e.y2);        // 线段
    return e.y;                                          // 色块：y 是顶边
  }

  function elBottom(e) {
    if (e.size != null) return e.y + e.size * 0.26;
    if (e.yTop != null) return e.yTop + (e.h || 0);
    if (e.y1 != null) return Math.max(e.y1, e.y2);
    return e.y + (e.h || 0);
  }

  function shift(e, dy) {
    var o = {};
    Object.keys(e).forEach(function (k) { o[k] = e[k]; });
    if (o.size != null) o.y = o.y + dy;
    else if (o.yTop != null) o.yTop = o.yTop + dy;
    else if (o.y1 != null) { o.y1 = o.y1 + dy; o.y2 = o.y2 + dy; }
    else o.y = o.y + dy;
    return o;
  }

  function boundsOf(pg) {
    var top = Infinity, bot = -Infinity;
    function eat(e) {
      var t = elTop(e), b = elBottom(e);
      if (t != null && t < top) top = t;
      if (b != null && b > bot) bot = b;
    }
    (pg.rects || []).forEach(eat); (pg.lines || []).forEach(eat);
    (pg.images || []).forEach(eat); (pg.runs || []).forEach(eat);
    return top === Infinity ? null : { top: top, bottom: bot };
  }

  /**
   * 多页 PDF → 单页：把后续页的内容紧接在第一页下方，再从末尾**整行**删除，
   * 直到装进一页。删除的粒度是「一整行」——字号、颜色、字体、列位置一概不动，
   * 只是少了那几行字，这才符合「只改文字不改排版」。
   *
   * 只删「要点行」（项目符号开头）与它的折行续行；碰到章节标题这类行就停手。
   */
  function stitch(pages, opt) {
    pages = (pages || []).filter(Boolean);
    if (!pages.length) return [];
    if (pages.length === 1) return pages;
    opt = opt || {};

    var base = pages[0];
    var H = base.height;
    var limit = H - (opt.bottomPad != null ? opt.bottomPad : 16);

    var rects = (base.rects || []).slice();
    var lines = (base.lines || []).slice();
    var images = (base.images || []).slice();
    var runs = (base.runs || []).slice();

    // ① 逐页接到第一页内容下方
    var cur = boundsOf(base);
    var curBottom = cur ? cur.bottom : 0;
    for (var i = 1; i < pages.length; i++) {
      var pg = pages[i];
      var b = boundsOf(pg);
      if (!b) continue;                                  // 空白页，直接丢掉

      // 接缝处要留够行距。若这一页的第一行是章节标题（有灰底通栏压着），
      // 它的色块从基线往上 15pt，间距给小了会盖住上一页的最后一行。
      var gap = 14;
      var rs = (pg.runs || []).slice().sort(function (a, c) { return a.y - c.y; });
      if (rs.length && (pg.rects || []).length) {
        var banded = pg.rects.some(function (r) {
          return r.y <= rs[0].y + 1 && r.y + r.h >= rs[0].y - 2;
        });
        if (banded) gap = 24;
      }

      var dy = (curBottom + gap) - b.top;
      (pg.rects || []).forEach(function (e) { rects.push(shift(e, dy)); });
      (pg.lines || []).forEach(function (e) { lines.push(shift(e, dy)); });
      (pg.images || []).forEach(function (e) { images.push(shift(e, dy)); });
      (pg.runs || []).forEach(function (e) { runs.push(shift(e, dy)); });
      curBottom = b.bottom + dy;
    }

    // ② 按基线分组，得到「行」
    function groupRows(list) {
      var sorted = list.slice().sort(function (a, b) { return b.y - a.y; });
      var rows = [];
      sorted.forEach(function (r) {
        var tol = Math.max(1.2, r.size * 0.42);
        var last = rows[rows.length - 1];
        if (last && Math.abs(last.y - r.y) <= tol) { last.runs.push(r); }
        else rows.push({ y: r.y, size: r.size, runs: [r] });
      });
      rows.forEach(function (row) {
        row.runs.sort(function (a, b) { return a.x - b.x; });
        row.text = row.runs.map(function (r) { return r.text; }).join('');
        row.x = row.runs[0].x;
        row.top = Math.min.apply(null, row.runs.map(elTop));
        row.bottom = Math.max.apply(null, row.runs.map(elBottom));
      });
      return rows;
    }

    function maxBottom() {
      var m = 0;
      rects.forEach(function (e) { var b = elBottom(e); if (b > m) m = b; });
      lines.forEach(function (e) { var b = elBottom(e); if (b > m) m = b; });
      images.forEach(function (e) { var b = elBottom(e); if (b > m) m = b; });
      runs.forEach(function (e) { var b = elBottom(e); if (b > m) m = b; });
      return m;
    }

    // ③ 决定删哪些行（从底部往上，只删要点行及其折行续行）
    var rows = groupRows(runs).sort(function (a, b) { return a.y - b.y; });  // 页顶 → 页底
    var keep = rows.map(function () { return true; });

    function headOf(r) { return (r.text || '').replace(/^[\s\u00a0\u3000]+/, ''); }
    function deletable(k) {
      if (k < 1 || !keep[k]) return false;
      var row = rows[k];
      if (BULLET_RE.test(headOf(row))) return true;
      // 折行续行：左缩进与上一行一致，且上一行是要点
      var up = rows[k - 1];
      if (!up) return false;
      return Math.abs(row.x - up.x) < 1.5 && BULLET_RE.test(headOf(up));
    }

    /** 当前（已决定删除哪些行之后）内容的最低点 —— 必须算上重排带来的上移 */
    function lastBottom() {
      var acc = 0, m = 0;
      for (var i = 0; i < rows.length; i++) {
        if (!keep[i]) {
          var nextY = (i + 1 < rows.length) ? rows[i + 1].y : (rows[i].y + (rows[i].bottom - rows[i].top));
          acc += Math.max(0, nextY - rows[i].y);
          continue;
        }
        if (rows[i].bottom - acc > m) m = rows[i].bottom - acc;
      }
      images.forEach(function (e) { var b = elBottom(e); if (b > m) m = b; });
      return m;
    }

    var removed = 0, guard = 0;
    function dropOne() {
      var pick = -1;
      for (var k = rows.length - 1; k >= 1; k--) { if (deletable(k)) { pick = k; break; } }
      if (pick < 0) return false;
      keep[pick] = false;
      removed++;
      return true;
    }

    // ⑤ 要点被删光的项目标题，留着是孤零零一行 —— 整块去掉
    /** 这一行是否是某个灰底通栏章节标题 */
    function bandedAt(i) {
      var y = rows[i].y;
      return rects.some(function (r) {
        return r.y <= y + 1 && (r.y + r.h) >= y - 15;
      });
    }
    function isHeadRow(i) {
      if (BULLET_RE.test(headOf(rows[i]))) return false;
      var up = rows[i - 1];
      if (!up) return true;
      if (bandedAt(i - 1)) return false;        // 紧跟章节标题的行 = 该章节的描述行
      if (bandedAt(i)) return true;             // 灰底通栏 = 章节标题，一定是块头
      return Math.abs(rows[i].x - up.x) > 1.5;  // 左端对齐 = 折行续行，不是标题
    }
    function pruneOrphanHeads() {
      var i2 = 0, cut = 0;
      while (i2 < rows.length) {
        if (!isHeadRow(i2)) { i2++; continue; }
        var end = i2 + 1;
        while (end < rows.length && !isHeadRow(end)) end++;
        var bodyKept = false;
        for (var q = i2 + 1; q < end; q++) if (keep[q]) { bodyKept = true; break; }
        if (!bodyKept) {
          for (var q2 = i2; q2 < end; q2++) if (keep[q2]) { keep[q2] = false; cut++; }
        }
        i2 = end;
      }
      return cut;
    }

    while (lastBottom() > limit && guard++ < 600) {
      if (!dropOne()) break;                        // 剩下的全是标题，再删就没内容了
      // 每删掉一批就清理一次空标题，避免「标题还在、要点没了」的残块
      removed += pruneOrphanHeads();
    }
    removed += pruneOrphanHeads();
    // 清掉空标题后可能还有空间没让出来，再补一轮
    while (lastBottom() > limit && guard++ < 900) {
      if (!dropOne()) break;
      removed += pruneOrphanHeads();
    }

    // ④ 统一重排：每行上移「它之前被删掉的总高度」。
    // 一次算完而不是边删边移 —— 边删边移会累计漂移，把章节标题压到正文上。
    var delta = [], acc = 0;
    for (var i = 0; i < rows.length; i++) {
      delta[i] = -acc;
      if (!keep[i]) {
        var nextY = (i + 1 < rows.length) ? rows[i + 1].y : (rows[i].y + (rows[i].bottom - rows[i].top));
        acc += Math.max(0, nextY - rows[i].y);
      }
    }

    /** 某个 y 落在哪一行（最近的基线） */
    function rowAt(y) {
      var best = 0, bd = Infinity;
      for (var j = 0; j < rows.length; j++) {
        var d = Math.abs(rows[j].y - y);
        if (d < bd) { bd = d; best = j; }
      }
      return best;
    }

    var outRuns = [], outRects = [], outLines = [];
    runs.forEach(function (r) {
      var j = rowAt(r.y);
      if (!keep[j]) return;                      // 被删行的文字一并去掉
      outRuns.push(delta[j] ? shift(r, delta[j]) : r);
    });
    [].concat(rects).forEach(function (e) {
      var j = rowAt((elTop(e) + elBottom(e)) / 2);
      if (!keep[j]) return;                      // 标题的灰底通栏 / 竖条跟着标题一起走
      outRects.push(delta[j] ? shift(e, delta[j]) : e);
    });
    lines.forEach(function (e) {
      var j = rowAt((elTop(e) + elBottom(e)) / 2);
      if (!keep[j]) return;
      outLines.push(delta[j] ? shift(e, delta[j]) : e);
    });

    return [{
      width: base.width, height: base.height,
      rects: outRects, lines: outLines, images: images, runs: outRuns,
      stitched: pages.length, removedRows: removed
    }];
  }

  /* ---------------- 文字流 ---------------- */


  /**
   * 把所有页的文字段拼成一条流。
   * norm 是「去掉空白后的字符流」，map[i] 记录 norm 第 i 个字符在 raw 里的位置。
   */
  function buildStream(pages) {
    var norm = '', map = [], raw = '';
    var spans = [];
    pages.forEach(function (pg, pi) {
      if (pi > 0) raw += '\u0000';                 // 页哨兵：不可能出现在归一化流里
      var runs = (pg.runs || []).slice().sort(function (a, b) {
        return (b.y - a.y) || (a.x - b.x);
      });
      var lastY = null;
      runs.forEach(function (r) {
        var lineStart = (lastY == null) || Math.abs(lastY - r.y) > Math.max(0.6, r.size * 0.4);
        lastY = r.y;
        var st = raw.length;
        for (var i = 0; i < r.text.length; i++) {
          var ch = r.text.charAt(i);
          var ri = raw.length;
          raw += ch;
          if (WS.test(ch)) continue;
          if (lineStart && BULLET_RE.test(ch)) { lineStart = false; continue; }
          norm += ch;
          map.push(ri);
          lineStart = false;
        }
        spans.push({ run: r, page: pi, start: st, end: raw.length });
      });
    });
    return { norm: norm, map: map, raw: raw, spans: spans };
  }

  /** 某个 raw 位置所在行的结束位置 */
  function lineEnd(st, ri) {
    for (var i = 0; i < st.spans.length; i++) {
      var s = st.spans[i];
      if (ri >= s.start && ri < s.end) return s.end;
    }
    return ri + 1;
  }

  /** 在归一化流里找一段文字对应的 raw 区间 */
  function findSpan(st, key) {
    if (!key) return null;
    var ni = st.norm.indexOf(key);
    if (ni >= 0) {
      return { rs: st.map[ni], re: st.map[ni + key.length - 1] + 1, exact: true };
    }
    // 兜底：原文字流与模型侧文字有细微差异时，用前几个字定位到行首
    var probe = key.slice(0, Math.min(8, key.length));
    if (probe.length < 4) return null;
    var pi = st.norm.indexOf(probe);
    if (pi < 0) return null;
    return { rs: st.map[pi], re: lineEnd(st, st.map[pi]), exact: false };
  }

  /** 落在 raw 区间内的文字段 */
  function runsIn(st, rs, re) {
    var out = [];
    for (var i = 0; i < st.spans.length; i++) {
      var s = st.spans[i];
      if (s.end <= rs || s.start >= re) continue;
      out.push({
        idx: i,
        span: s,
        from: Math.max(0, rs - s.start),
        to: Math.min(s.end, re) - s.start
      });
    }
    return out;
  }

  /* ---------------- 块的几何 ---------------- */

  /** 一段连续文字块的整体几何：起止 x、首个基线、占几行、行距 */
  function blockGeom(spans, i0, i1) {
    var x = Infinity, firstY = -Infinity, right = -Infinity, size = 0;
    var baselines = [];
    for (var i = i0; i <= i1; i++) {
      var r = spans[i].run;
      if (r.x < x) x = r.x;
      if (r.y > firstY) { firstY = r.y; }
      if (r.x + r.w > right) right = r.x + r.w;
      if (r.size > size) size = r.size;
      if (baselines.indexOf(r.y) < 0) baselines.push(r.y);
    }
    baselines.sort(function (a, b) { return b - a; });
    return {
      x: x, y: firstY, right: right, size: size,
      lines: baselines.length,
      baselines: baselines,
      lineH: baselines.length > 1 ? (baselines[0] - baselines[1]) : 0
    };
  }

  /* ---------------- 主流程 ---------------- */

  /**
   * @param {Array} pages  [{width,height,runs:[…],rects,lines,images}]
   * @param {Array} ops    ResumeInplace.collectOps 的产物
   * @returns {object} 渲染规格
   */
  function build(pages, ops) {
    pages = pages || [];
    var st = buildStream(pages);

    // 每页的版心右缘（用于判断「新文字会不会太宽」）
    var pageRight = pages.map(function (pg) {
      var m = 0;
      (pg.runs || []).forEach(function (r) { if (r.x + r.w > m) m = r.x + r.w; });
      return m;
    });

    var repl = [];      // spanIdx → {group, runs}
    var groups = [];
    var subs = {};      // spanIdx → {from,to}
    var inserts = {};   // spanIdx → [run]
    var matched = 0, missed = [];

    function styleOf(run) {
      return { x: run.x, y: run.y, size: run.size, color: run.color, base: run.base, font: run.font };
    }

    (ops || []).forEach(function (op) {
      if (op.kind === 'insert') {
        var isp = findSpan(st, normKey(op.after));
        if (!isp) { missed.push(op.text || op.after); return; }
        var covI = runsIn(st, isp.rs, isp.re);
        if (!covI.length) { missed.push(op.text || op.after); return; }
        var last = covI[covI.length - 1];
        var i1 = last.idx;
        // 插入点：被匹配行下面一行，同一个左边界
        var anchor = st.spans[i1].run;
        var g = blockGeom(st.spans, Math.max(0, i1 - 1), i1);
        var nextY = anchor.y - (g.lineH || anchor.size * 1.45);
        var bullet = /^\s*[·•▪◦※*+—\-]/.exec(anchor.text);
        var text = (bullet ? bullet[0].trim() + ' ' : '') + op.text;
        var nr = styleOf(anchor);
        nr.text = text;
        nr.x = g.x;
        nr.y = Math.round(nextY * 10) / 10;
        nr.size = anchor.size;
        nr.color = anchor.color;
        nr.page = st.spans[i1].page;
        nr.newRun = true;
        (inserts[i1] || (inserts[i1] = [])).push(nr);
        matched++;
        return;
      }

      var key = normKey(op.from);
      var sp = findSpan(st, key);
      if (!sp) { missed.push(op.from); return; }
      var cov = runsIn(st, sp.rs, sp.re);
      if (!cov.length) { missed.push(op.from); return; }
      var i0 = cov[0].idx, i1 = cov[cov.length - 1].idx;

      if (op.kind === 'sub') {
        if (i0 === i1) {
          var s0 = st.spans[i0];
          var txt = s0.run.text;
          var a = Math.max(0, sp.rs - s0.start);
          var b = Math.min(txt.length, sp.re - s0.start);
          subs[i0] = { from: txt.slice(a, b), to: op.to };
          matched++;
          return;
        }
        // 跨段的小替换：并成一段重画
      }

      var geom = blockGeom(st.spans, i0, i1);
      var head = st.spans[i0].run;
      var to = op.kind === 'split' ? op.to.join('\n') : (op.to == null ? '' : op.to);
      var texts = (op.kind === 'split') ? op.to : String(to).split('\n');

      var runsOut = [];
      for (var t = 0; t < texts.length; t++) {
        if (!texts[t] && t > 0) continue;
        var nr = styleOf(head);
        nr.text = texts[t];
        nr.x = geom.x;
        nr.y = t === 0 ? geom.y : Math.round((geom.baselines[1] != null
          ? geom.baselines[1] - (t - 1) * (geom.lineH || head.size * 1.45)
          : geom.y - t * head.size * 1.45) * 10) / 10;
        nr.size = head.size;
        nr.color = head.color;
        nr.base = head.base;
        nr.page = st.spans[i0].page;
        nr.replaced = true;
        // 段落原本占多行 → 允许按原行距折行；原本单行 → 保持单行
        if (geom.lines > 1) {
          nr.wrapW = Math.max(20, geom.right - geom.x);
          nr.lineH = geom.lineH || head.size * 1.45;
        } else {
          nr.wrapW = 0;
          // 单行改写后如果太宽，按比例缩一点字号（只缩这一行，不动其它版面）
          var avail = (pageRight[head.page != null ? head.page : 0] || geom.right) - geom.x;
          var need = estWidth(nr.text, head.size);
          if (avail > 20 && need > avail) {
            nr.size = Math.max(head.size * 0.85, Math.round(head.size * avail / need * 100) / 100);
          }
        }
        runsOut.push(nr);
      }

      var gid = groups.length;
      groups.push({ i0: i0, i1: i1 });
      for (var k = i0; k <= i1; k++) repl[k] = { group: gid, runs: k === i0 ? runsOut : [] };
      matched++;
    });

    /* ---- 重建文字段 ---- */
    var out = [];
    st.spans.forEach(function (s, i) {
      var rep = repl[i];
      if (rep) {
        if (rep.runs.length) out = out.concat(rep.runs);
      } else {
        var run = {};
        Object.keys(s.run).forEach(function (k) { run[k] = s.run[k]; });
        run.page = s.page;
        var sub = subs[i];
        if (sub && sub.from) {
          run.text = run.text.replace(sub.from, sub.to);
          run.replaced = true;
        }
        out.push(run);
      }
      if (inserts[i]) out = out.concat(inserts[i]);
    });

    return {
      pages: pages.map(function (pg, pi) {
        var o = {};
        Object.keys(pg).forEach(function (k) { o[k] = pg[k]; });
        o.runs = out.filter(function (r) { return (r.page || 0) === pi; });
        return o;
      }),
      runs: out,
      stats: { matched: matched, missed: missed }
    };
  }

  var api = {
    build: build, stitch: stitch, normKey: normKey, estWidth: estWidth, buildStream: buildStream
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ResumePaintDoc = api;
})(typeof window !== 'undefined' ? window : this);

/* pdfpaint.js — 把 PDF 的「绘制指令」整条搬出来，而不是猜几个参数再重建
 *
 * 背景：之前的「保留原版式」只从 PDF 里搬了 6 个参数（页边距 / 字号 / 行距 /
 * 缩进 / 右对齐日期 / 分隔线），然后用 CSS 流式 div 从零重建一份简历。
 * 结果原文档里的 **灰底通栏、标题左侧黑色竖条、中英文双色双字号、三列并排、
 * 照片原位** 一样都没保留 —— 看起来根本不是用户的那份简历。
 *
 * 这里换一条路：直接读 pdf.js 的 operator list，把 PDF 画过的每一样东西取出来：
 *   · rect   色块（灰底通栏 / 黑色竖条）
 *   · line   描边（分隔线）
 *   · text   文字段（精确 x、基线 y、字号、颜色、字体名）
 *   · img    图片（证件照）
 * 全部按 PDF 原始坐标输出（y 已换算成「距页顶」），渲染时绝对定位贴回原位。
 *
 * 坐标约定：单位 pt，y 自页顶向下（PDF 的 y 自底向上，这里做了翻转）。
 */
(function (root) {
  'use strict';

  /* ---------------- 字体名 → CSS ---------------- */

  /* 常见中英文字体族 → CSS font-family。按顺序匹配，先命中先用。 */
  var FAM_MAP = [
    [/yahei|微软雅黑/i, '"Microsoft YaHei","微软雅黑","PingFang SC","Noto Sans SC",sans-serif'],
    [/simsun|宋体|songti/i, '"SimSun","宋体","Songti SC","Noto Serif SC",serif'],
    [/simhei|黑体|heiti/i, '"SimHei","黑体","Microsoft YaHei",sans-serif'],
    [/kaiti|楷体/i, '"KaiTi","楷体","STKaiti","Noto Serif SC",serif'],
    [/fangsong|仿宋/i, '"FangSong","仿宋","STFangsong","Noto Serif SC",serif'],
    [/noto\s*serif|source\s*han\s*serif|思源宋/i, '"Noto Serif SC","Source Han Serif SC","Songti SC",serif'],
    [/noto\s*sans|source\s*han\s*sans|思源黑/i, '"Noto Sans SC","Source Han Sans SC","PingFang SC","Microsoft YaHei",sans-serif'],
    [/dengxian|等线/i, '"DengXian","等线","Microsoft YaHei",sans-serif'],
    [/times/i, '"Times New Roman",Times,serif'],
    [/georgia/i, 'Georgia,serif'],
    [/arial|helvetica/i, 'Arial,Helvetica,sans-serif'],
    [/calibri/i, '"Calibri","Segoe UI",sans-serif'],
    [/courier|consol/i, '"Courier New",monospace']
  ];

  var DEFAULT_FAM = '"Microsoft YaHei","微软雅黑","PingFang SC","Noto Sans SC",sans-serif';

  /** 去掉子集前缀（ABCDEF+），得到真正的字体名 */
  function stripSubset(name) {
    return String(name || '').replace(/^[A-Z]{6}\+/i, '').trim();
  }

  /**
   * PDF 字体名 → CSS 样式描述
   * @param {string} baseFont  如 "TXYDTX+Microsoft YaHei Bold"
   * @returns {{family:string, weight:number, style:string, raw:string}}
   */
  function fontCss(baseFont) {
    var raw = stripSubset(baseFont);
    var fam = DEFAULT_FAM;
    for (var i = 0; i < FAM_MAP.length; i++) {
      if (FAM_MAP[i][0].test(raw)) { fam = FAM_MAP[i][1]; break; }
    }
    var bold = /bold|black|heavy|semibold|demi|ultra|ultrabold/i.test(raw);
    var italic = /italic|oblique/i.test(raw);
    return {
      family: fam,
      weight: bold ? 700 : 400,
      style: italic ? 'italic' : 'normal',
      raw: raw
    };
  }

  /* ---------------- 颜色 ---------------- */

  function to255(v) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    if (n <= 1) n = n * 255;          // pdf.js 有时给 0..1 的浮点
    if (n < 0) n = 0;
    if (n > 255) n = 255;
    return Math.round(n);
  }

  /** [r,g,b]（已是 0..255）→ '#rrggbb' */
  function hex(rgb) {
    var h = '#';
    for (var i = 0; i < 3; i++) {
      var n = Math.round(Number(rgb && rgb[i]) || 0);
      if (n < 0) n = 0;
      if (n > 255) n = 255;
      var v = n.toString(16);
      h += v.length < 2 ? '0' + v : v;
    }
    return h;
  }

  /**
   * 颜色参数统一成 [r,g,b]。
   * pdf.js 有两条路径：setFillRGBColor 给 0..255 的整数；setFillColor 给
   * 0..1 的浮点（灰度 / RGB / CMYK 都有可能，取决于当前色彩空间）。
   */
  function rgbOf(a, isRGB) {
    var v = (a && a.length === 1 && Array.isArray(a[0])) ? a[0] : a;
    if (!v || !v.length) return null;
    function cv(x) { return isRGB ? Math.max(0, Math.min(255, Math.round(Number(x) || 0))) : to255(x); }
    if (v.length === 1) { var g = cv(v[0]); return [g, g, g]; }
    if (v.length === 3) return [cv(v[0]), cv(v[1]), cv(v[2])];
    if (v.length === 4) {                      // CMYK
      var c = v[0], m = v[1], y = v[2], k = v[3];
      return [to255((1 - c) * (1 - k)), to255((1 - m) * (1 - k)), to255((1 - y) * (1 - k))];
    }
    return null;
  }

  /* ---------------- 矩阵 ---------------- */

  function mul(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
    ];
  }

  function apply(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  /** 矩阵的等比缩放（行列式开方） */
  function scaleOf(m) {
    var det = Math.abs(m[0] * m[3] - m[1] * m[2]);
    return Math.sqrt(det) || 1;
  }

  /* ---------------- 路径解析 ---------------- */

  /**
   * 把 constructPath 的参数解析成设备坐标下的矩形与线段。
   * constructPath args = [opsArray, coordsArray, minMax]
   */
  function parsePath(args, ctm, OPS) {
    var opsArr = args[0] || [], co = args[1] || [];
    var rects = [], segs = [];
    var k = 0, cur = null, subStart = null;

    function moveTo(x, y) { cur = [x, y]; subStart = [x, y]; }
    function lineTo(x, y) {
      if (!cur) { cur = [x, y]; subStart = cur; return; }
      segs.push({ x1: cur[0], y1: cur[1], x2: x, y2: y });
      cur = [x, y];
    }

    for (var s = 0; s < opsArr.length; s++) {
      var op = opsArr[s];
      if (op === OPS.rectangle) {
        var x = co[k], y = co[k + 1], w = co[k + 2], h = co[k + 3]; k += 4;
        var p1 = apply(ctm, x, y), p2 = apply(ctm, x + w, y + h);
        rects.push({
          x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]),
          w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1])
        });
        cur = null; subStart = null;
      } else if (op === OPS.moveTo) {
        moveTo(apply(ctm, co[k], co[k + 1])[0], apply(ctm, co[k], co[k + 1])[1]); k += 2;
      } else if (op === OPS.lineTo) {
        var lp = apply(ctm, co[k], co[k + 1]); k += 2; lineTo(lp[0], lp[1]);
      } else if (op === OPS.curveTo) {
        // 三点贝塞尔：控制点 ×2 + 终点；连线用终点近似
        var c1 = apply(ctm, co[k], co[k + 1]);
        var c2 = apply(ctm, co[k + 2], co[k + 3]);
        var c3 = apply(ctm, co[k + 4], co[k + 5]); k += 6;
        if (!cur) { cur = c3; subStart = c3; }
        else segs.push({ x1: cur[0], y1: cur[1], x2: c3[0], y2: c3[1] });
      } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
        var n = op === OPS.curveTo2 ? 4 : 4;
        var cend = apply(ctm, co[k + n - 2], co[k + n - 1]); k += n;
        if (!cur) { cur = cend; subStart = cend; }
        else segs.push({ x1: cur[0], y1: cur[1], x2: cend[0], y2: cend[1] });
      } else if (op === OPS.closePath) {
        if (cur && subStart && (Math.abs(cur[0] - subStart[0]) > 0.01 || Math.abs(cur[1] - subStart[1]) > 0.01)) {
          segs.push({ x1: cur[0], y1: cur[1], x2: subStart[0], y2: subStart[1] });
        }
        cur = null; subStart = null;
      }
    }
    return { rects: rects, segs: segs };
  }

  /* ---------------- 文字段 ---------------- */

  /** showText / showSpacedText 的字形数组 → {text, advance} */
  function readGlyphs(arg) {
    var text = '', adv = 0;
    var list = arg;
    if (!list) return { text: '', adv: 0 };
    // showSpacedText：数组里可能混着数字（字距调整，单位 1/1000 em）
    if (!Array.isArray(list) || typeof list.length !== 'number') return { text: '', adv: 0 };
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (typeof it === 'number') { adv += it / 1000; continue; }
      if (Array.isArray(it)) {
        for (var j = 0; j < it.length; j++) {
          var g = it[j];
          if (g && g.unicode != null) text += g.unicode;
          adv += (g && g.width ? g.width : 0) / 1000;
        }
        continue;
      }
      if (it && typeof it === 'object') {
        if (it.unicode != null) text += it.unicode;
        adv += (it.width ? it.width : 0) / 1000;
      }
    }
    return { text: text, adv: adv };
  }

  /**
   * 收集一页的全部绘制原语。
   *
   * @param {object} opsList  page.getOperatorList() 的结果
   * @param {object} OPS      pdfjsLib.OPS
   * @param {number} pageH    页面高度（pt）
   * @param {function} fontOf (内部字体名) => PDF 里的 BaseFont（可为 null）
   * @returns {{rects:Array, lines:Array, texts:Array}}
   */
  function collect(opsList, OPS, pageH, fontOf) {
    var ctm = [1, 0, 0, 1, 0, 0];
    var stack = [];
    var fill = [0, 0, 0], stroke = [0, 0, 0], lw = 1;
    var font = null, size = 0, tm = [1, 0, 0, 1, 0, 0];
    var rise = 0, hscale = 1;                  // Ts（上标/基线偏移）、Tz（水平缩放）
    var path = null;
    var rects = [], lines = [], texts = [];

    function flushFill() {
      if (!path) return;
      for (var i = 0; i < path.rects.length; i++) {
        var r = path.rects[i];
        if (r.w <= 0 || r.h <= 0) continue;
        rects.push({
          x: r.x, y: pageH - (r.y + r.h), w: r.w, h: r.h,
          fill: hex(fill), kind: 'rect'
        });
      }
    }

    function flushStroke() {
      if (!path) return;
      var sc = scaleOf(ctm);
      var w = Math.max(0.2, lw * sc);
      // 描边矩形 → 四条边
      for (var i = 0; i < path.rects.length; i++) {
        var r = path.rects[i];
        var y1 = pageH - r.y, y2 = pageH - (r.y + r.h);
        lines.push({ x1: r.x, y1: y1, x2: r.x + r.w, y2: y1, w: w, color: hex(stroke), kind: 'line' });
        lines.push({ x1: r.x + r.w, y1: y1, x2: r.x + r.w, y2: y2, w: w, color: hex(stroke), kind: 'line' });
        lines.push({ x1: r.x + r.w, y1: y2, x2: r.x, y2: y2, w: w, color: hex(stroke), kind: 'line' });
        lines.push({ x1: r.x, y1: y2, x2: r.x, y1: y1, w: w, color: hex(stroke), kind: 'line' });
      }
      for (var s = 0; s < path.segs.length; s++) {
        var g = path.segs[s];
        lines.push({
          x1: g.x1, y1: pageH - g.y1, x2: g.x2, y2: pageH - g.y2,
          w: w, color: hex(stroke), kind: 'line'
        });
      }
    }

    function pushText(arg) {
      var g = readGlyphs(arg);
      if (!g.text) return;
      // Ts（文字上升）沿文本空间的 y 轴偏移基线
      var tx = tm[4] + tm[2] * rise;
      var ty = tm[5] + tm[3] * rise;
      var o = apply(ctm, tx, ty);
      var xa = apply(ctm, tx + tm[0], ty + tm[1]);
      var ya = apply(ctm, tx + tm[2], ty + tm[3]);
      var sx = Math.hypot(xa[0] - o[0], xa[1] - o[1]) || 1;
      var sy = Math.hypot(ya[0] - o[0], ya[1] - o[1]) || 1;
      var w = g.adv * size * sx * hscale;
      texts.push({
        x: o[0],
        y: pageH - o[1],            // 基线（距页顶）
        size: size * sy,
        w: w,
        text: g.text,
        color: hex(fill),
        font: font,
        base: fontOf ? (fontOf(font) || '') : ''
      });
    }

    var fn = opsList.fnArray, ar = opsList.argsArray;
    for (var i = 0; i < fn.length; i++) {
      var op = fn[i], a = ar[i];
      try {
        if (op === OPS.save) { stack.push(ctm.slice()); continue; }
        if (op === OPS.restore) { ctm = stack.pop() || ctm; continue; }
        if (op === OPS.transform) { ctm = mul(ctm, a); continue; }

        // Form XObject：Word / Chrome / LaTeX 导出的 PDF 几乎都会把正文包进 form，
        // 不乘它的 matrix，里面的坐标会整体错位。
        if (op === OPS.paintFormXObjectBegin) {
          stack.push(ctm.slice());
          if (a && a[0] && a[0].length === 6) ctm = mul(ctm, a[0]);
          continue;
        }
        if (op === OPS.paintFormXObjectEnd) { ctm = stack.pop() || ctm; continue; }

        if (op === OPS.setFillRGBColor) { var c1 = rgbOf(a, true); if (c1) fill = c1; continue; }
        if (op === OPS.setFillColor) { var c2 = rgbOf(a, false); if (c2) fill = c2; continue; }
        if (op === OPS.setStrokeRGBColor) { var c3 = rgbOf(a, true); if (c3) stroke = c3; continue; }
        if (op === OPS.setStrokeColor) { var c4 = rgbOf(a, false); if (c4) stroke = c4; continue; }
        if (op === OPS.setLineWidth) { lw = a[0]; continue; }
        if (op === OPS.setFont) { font = a[0]; size = a[1]; continue; }
        if (op === OPS.setTextMatrix) { tm = [a[0], a[1], a[2], a[3], a[4], a[5]]; continue; }
        if (op === OPS.setTextRise) { rise = Number(a[0]) || 0; continue; }
        if (op === OPS.setHScale) { hscale = (Number(a[0]) || 100) / 100; continue; }
        if (op === OPS.constructPath) { path = parsePath(a, ctm, OPS); continue; }
        if (op === OPS.fill || op === OPS.eoFill) { flushFill(); continue; }
        if (op === OPS.stroke) { flushStroke(); continue; }
        if (op === OPS.fillStroke || op === OPS.closeFillStroke || op === OPS.closeEOFillStroke) {
          flushFill(); flushStroke(); continue;
        }
        if (op === OPS.showText || op === OPS.showSpacedText) { pushText(a[0]); continue; }
      } catch (e) {
        // 单个算子出错不影响整页 —— 丢掉一个原语，好过整页退回重建
      }
    }

    return { rects: rects, lines: lines, texts: texts };
  }

  /**
   * 把零散的文字段合并成「一段话」：
   * 同一基线、样式一致、且首尾相接（没有空隙）的相邻段合成一个 run。
   * 分栏并排的三段（日期 / 学校 / 专业）因为中间有空隙，不会被合并 ✓
   */
  function mergeRuns(texts) {
    var out = [];
    var sorted = texts.slice().sort(function (p, q) {
      return (q.y - p.y) || (p.x - q.x);
    });
    sorted.forEach(function (t) {
      var prev = out[out.length - 1];
      if (prev &&
        prev.base === t.base && prev.color === t.color &&
        Math.abs(prev.size - t.size) < 0.05 &&
        Math.abs(prev.y - t.y) < Math.max(0.6, t.size * 0.12)) {
        var gap = t.x - (prev.x + prev.w);
        if (gap > -0.6 && gap < Math.max(0.9, t.size * 0.35)) {
          prev.text += t.text;
          prev.w = (t.x + t.w) - prev.x;
          return;
        }
      }
      out.push({
        x: t.x, y: t.y, size: t.size, w: t.w, text: t.text,
        color: t.color, font: t.font, base: t.base
      });
    });
    return out;
  }

  var api = {
    collect: collect,
    mergeRuns: mergeRuns,
    fontCss: fontCss,
    stripSubset: stripSubset,
    hex: hex
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ResumePaint = api;
})(typeof window !== 'undefined' ? window : this);

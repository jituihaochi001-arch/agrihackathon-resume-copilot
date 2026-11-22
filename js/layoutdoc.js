/* layoutdoc.js — 把「原文件版式 + 采纳后的文字」合成为可渲染 / 可导出的排版规格
 *
 * 核心原则：**逐行照搬原文档，只替换文字**。
 * 版面参数（页边距 / 字号 / 缩进 / 右对齐日期 / 分隔线 / 证件照）全部来自原文件，
 * 不做任何语义重排；变的只有文字内容本身（被替换、被精简）。
 *
 * 同一份规格同时喂给屏幕预览、PDF、DOCX，保证三处完全一致，并且恒定一页。 */
(function (root) {
  'use strict';

  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/[\s\u00a0\u3000]/g, '')
      .replace(/^[·•▪◦※*+]+/, '');
  }

  var BULLET_RE = /^[·•▪◦※*+]\s*/;

  /**
   * 「这是一条新条目」的特征：行首带项目符号或自动编号。
   * 用来区分两种长得很像的行：
   *   · 同一条要点被 PDF 折行后的**续行**（行首没有符号）
   *   · 下一条**独立的要点**（行首有符号）
   * 只看「上一行是否排满版心」是不够的 —— 相邻的两条要点同样会排满版心，
   * 那样会把整段要点粘成一大块。
   */
  var ITEM_RE = /^(?:[·•▪◦※*+●◆]\s*|\d+[.、)）]\s*|[（(]\d+[)）]\s*|[①-⑳]\s*|[-–—]\s+)/;

  /** 行尾是句号类标点 → 这一句已经说完，下一行不是它的续行 */
  function endsSentence(s) {
    return /[。！？!?…]\s*$/.test(String(s || ''));
  }

  /**
   * 估算一段文字的真实宽度（pt）：中文按 1em，西文按字符类别折算。
   * 与 pdflayout.textWidth 保持一致 —— 那里用于修正 pdf.js 虚高的宽度，
   * 这里用于判断「这行文字会不会伸到照片下面」「这行是不是排满了版心」。
   */
  function estWidth(s, size) {
    var str = String(s == null ? '' : s);
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c > 0x2e80 && c < 0xa4d0) w += 1;        // CJK 全角
      else if (c === 32) w += 0.3;                  // 空格
      else if (c >= 48 && c <= 57) w += 0.56;       // 数字
      else if (c >= 65 && c <= 90) w += 0.7;        // 大写字母
      else if (c >= 97 && c <= 122) w += 0.53;      // 小写字母
      else w += 0.36;                               // 标点
    }
    return w * size;
  }

  /**
   * 把 PDF 里被换行拆开的同一条要点合并回一段。
   * 合并时记下原始的换行位置（breaks）与段内行距（innerGap），
   * 渲染时按原换行点还原，文字被改写后才交给浏览器自然回流。
   *
   * 判定「是续行」需要三条同时成立：
   *   ① 上一行排满了版心（不排满就没有折行的理由）
   *   ② 下一行不是一条新条目（行首没有项目符号 / 自动编号）
   *   ③ 上一行还没说完（行尾不是句号类标点）
   */
  function mergeWrapped(lines, contentRight) {
    var out = [];
    lines.forEach(function (l) {
      var prev = out[out.length - 1];
      if (!prev) { out.push(l); return; }
      var avail = contentRight - prev.x;
      var wrapped =
        !prev.right && !l.right && !l.head && !prev.rule &&
        Math.abs(l.size - prev.size) < 0.4 &&
        l.indent >= prev.indent - 0.6 &&
        prev.textW >= avail - l.size * 2.2 &&
        !ITEM_RE.test(l.text) &&          // 下一行是新条目 → 不合并
        !endsSentence(prev.text);         // 上一行已完句 → 不合并
      if (wrapped) {
        var joiner = /[A-Za-z0-9]$/.test(prev.text) && /^[A-Za-z0-9]/.test(l.text) ? ' ' : '';
        var off = prev.text.length + joiner.length;
        prev.breaks = (prev.breaks || []).concat([off]);
        prev.text = prev.text + joiner + l.text;
        prev.innerGap = Math.round(((prev.innerGap || 0) + l.gap) * 10) / 10;
        prev.rows = (prev.rows || 1) + 1;
        prev.textW = Math.round((prev.textW + l.textW) * 10) / 10;
        prev._endX = l._endX;
        return;
      }
      out.push(l);
    });
    return out;
  }

  /** 取出行首的项目符号前缀（替换文字时要原样带回去） */
  function bulletPrefix(text) {
    var m = BULLET_RE.exec(String(text == null ? '' : text));
    return m ? m[0] : '';
  }

  /** 应用「原文 → 改后」的差异，落回到具体行上 */
  function applyOps(lines, ops) {
    var subs = [];
    var inserts = Object.create(null);
    var paras = [];                       // 整段替换：{ from, to }

    (ops || []).forEach(function (op) {
      if (op.kind === 'para') paras.push({ from: op.from, to: op.to });
      else if (op.kind === 'split') paras.push({ from: op.from, to: op.to.join('\n') });
      else if (op.kind === 'sub' && op.from !== op.to) subs.push(op);
      else if (op.kind === 'insert') {
        var k = norm(op.after);
        (inserts[k] || (inserts[k] = [])).push(op.text);
      }
    });

    var out = [];
    var used = Object.create(null);

    // ① 逐行精确匹配
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var key = norm(l.text);
      var hit = -1;
      for (var p = 0; p < paras.length; p++) {
        if (used[p]) continue;
        if (norm(paras[p].from) === key) { hit = p; break; }
      }
      if (hit >= 0) {
        used[hit] = 1;
        var val = paras[hit].to;
        if (!val) continue;                              // 删除该行（内容被精简掉）
        var bpre = bulletPrefix(l.text);                // 原文档这一行是带符号的
        String(val).split('\n').forEach(function (t, pi) {
          var copy = {};
          Object.keys(l).forEach(function (k2) { copy[k2] = l[k2]; });
          copy.text = pi === 0 ? bpre + t : t;           // 符号跟着走，版式不变
          if (norm(t) !== key) {                        // 文字变了，原始换行点不再适用
            copy.breaks = null;
            copy.rows = 1;
            copy.innerGap = 0;
          }
          if (pi > 0) { copy.gap = Math.round(l.size * 1.66 * 10) / 10; copy.right = ''; copy.rule = false; }
          out.push(copy);
        });
      } else {
        out.push(l);
      }

      var extra = inserts[key];
      if (extra) {
        extra.forEach(function (t) {
          out.push({
            text: t, right: '', rightSize: 0, size: l.size, bold: false,
            indent: l.indent, gap: Math.round(l.size * 1.66 * 10) / 10,
            rule: false, head: false, x: l.x, rows: 1,
            pageIndex: l.pageIndex, origTop: l.origTop, origBottom: l.origBottom
          });
        });
        delete inserts[key];
      }
    }

    // ② 跨行匹配：PDF 里一个段落常被拆成好几行，模型侧是一整段，
    //    这里把连续几行拼起来比对，命中后整体替换。
    for (var q = 0; q < paras.length; q++) {
      if (used[q]) continue;
      var target = norm(paras[q].from);
      if (!target) continue;
      var found = -1, span = 0;
      for (var sp = 2; sp <= 8 && found < 0; sp++) {
        for (var i2 = 0; i2 + sp <= out.length; i2++) {
          var buf = '';
          for (var k3 = 0; k3 < sp; k3++) buf += out[i2 + k3].text;
          if (norm(buf) === target) { found = i2; span = sp; break; }
        }
      }
      if (found < 0) continue;
      used[q] = 1;
      var base = out[found];
      var val2 = paras[q].to;
      if (!val2) { out.splice(found, span); continue; }
      var rep = [];
      var bpre2 = bulletPrefix(base.text);
      String(val2).split('\n').forEach(function (t, pi) {
        var copy = {};
        Object.keys(base).forEach(function (k4) { copy[k4] = base[k4]; });
        copy.text = pi === 0 ? bpre2 + t : t;
        copy.breaks = null;
        copy.rows = 1;
        copy.innerGap = 0;
        rep.push(copy);
      });
      out.splice.apply(out, [found, span].concat(rep));
    }

    // ③ 段内小替换（日期、城市等）
    if (subs.length) {
      out.forEach(function (l) {
        subs.forEach(function (op) {
          if (l.text.indexOf(op.from) >= 0) l.text = l.text.replace(op.from, op.to);
          if (l.right && l.right.indexOf(op.from) >= 0) l.right = l.right.replace(op.from, op.to);
        });
      });
    }

    return out;
  }

  /* ---------------- 版面测量 ---------------- */

  /**
   * 统一的高度测算：
   *   · lineH     —— 行内行距（CSS line-height），多行段落按段内实际间距取
   *   · gapBefore —— 段前距（首行基线差里超出一行高度的部分）
   *   · 行盒总高  = gapBefore + rows × lineH
   * 同时把自然值记入 baseLineH / baseGap，作为后续「幂等收紧」的基准。
   */
  function measure(lines) {
    var total = 0, y = 0;
    lines.forEach(function (l) {
      var rows = l.rows || 1;
      var gap = l.gap || 0;
      var lh = (rows > 1 && l.innerGap)
        ? Math.max(l.size * 1.16, l.innerGap / (rows - 1))
        : l.natural;
      l.lineH = Math.round(lh * 10) / 10;
      l.gapBefore = Math.max(0, Math.round((gap - lh) * 10) / 10);
      l.baseLineH = l.lineH;
      l.baseGap = l.gapBefore;
      l.rows = rows;
      l.flowTop = Math.round(y * 10) / 10;
      var h = l.gapBefore + rows * l.lineH;
      y += h;
      total += h;
    });
    return total;
  }

  /** 只重算纵向坐标与总高，不动 lineH / gapBefore（收敛时可反复调用） */
  function reflow(spec) {
    var total = 0, y = 0;
    (spec.lines || []).forEach(function (l) {
      l.flowTop = Math.round(y * 10) / 10;
      var h = l.gapBefore + (l.rows || 1) * l.lineH;
      y += h;
      total += h;
    });
    spec.used = Math.round(total * 10) / 10;
    spec.overflow = Math.max(0, Math.round(total - spec.contentH));
    spec.fits = spec.overflow <= 1;
    return total;
  }

  /* ---------------- 证件照：锚定 + 避让 ---------------- */

  /**
   * 把照片锚定到「原本与它并排的那一行」上。
   * 这样即使前面的内容被精简、整块上移，照片与姓名/联系方式的相对关系也不会变，
   * 不会出现「照片压住姓名」。
   */
  function anchorPhoto(spec) {
    var ph = spec.photo;
    if (!ph) return;
    var lines = spec.lines || [];
    var margin = spec.margin;
    var pi = ph.pageIndex == null ? 0 : ph.pageIndex;
    var phTop0 = ph.y0 != null ? ph.y0 : ph.yTop;
    var phBot0 = phTop0 + ph.h;

    var anchor = null, bestD = 1e9;
    lines.forEach(function (l) {
      if (l.pageIndex !== pi) return;
      var top = margin.t + l.flowTop;
      var bot = top + (l.rows || 1) * l.lineH;
      if (bot <= phTop0 + 1 || top >= phBot0 - 1) return;   // 与照片没有纵向重叠
      var d = Math.abs((top + bot) / 2 - (phTop0 + phBot0) / 2);
      if (d < bestD) { bestD = d; anchor = l; }
    });

    var phTop = phTop0;
    if (anchor) {
      // 锚点行相对原位置移动了多少，照片就跟着移动多少
      phTop = phTop0 + ((margin.t + anchor.flowTop) - anchor.origTop);
    }
    phTop = Math.max(0, Math.round(phTop * 10) / 10);
    phTop = Math.min(phTop, Math.round((spec.page.h - ph.h - 4) * 10) / 10);
    ph.yTop = phTop;
  }

  /**
   * 避让：原本排在照片下方的行，如果因为精简而上移侵入了照片的纵向区间，
   * 就把它推到照片下方（按文字实际右缘判断，够短的不用动）。
   */
  function computePads(spec) {
    var ph = spec.photo;
    var lines = spec.lines || [];
    if (!ph) return;
    var margin = spec.margin;
    var pi = ph.pageIndex == null ? 0 : ph.pageIndex;
    var phBot0 = (ph.y0 != null ? ph.y0 : ph.yTop) + ph.h;

    lines.forEach(function (l) { l.padNeed = 0; });

    for (var guard = 0; guard < 60; guard++) {
      var hit = null;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i];
        if (l.pageIndex !== pi) continue;
        if (l.origTop < phBot0 - 1) continue;               // 原本就与照片并排，不算侵入
        var top = margin.t + l.flowTop;
        var bot = top + (l.rows || 1) * l.lineH;
        if (top >= ph.yTop + ph.h - 0.5 || bot <= ph.yTop + 0.5) continue;
        var right = Math.max(l._endX || 0, l.x + estWidth(l.text, l.size));
        if (right <= ph.x - 2) continue;                      // 文字够短，不会压到照片
        hit = l;
        break;
      }
      if (!hit) break;
      var need = (ph.yTop + ph.h) - (margin.t + hit.flowTop) + 1;
      hit.padNeed = Math.max(hit.padNeed || 0, Math.max(0, need));
      hit.padTop = hit.padNeed;
      reflow(spec);
    }
  }

  /** 照片位置 + 避让量一起算（幂等：每次都从原始版式重算） */
  function placePhoto(spec) {
    if (!spec.photo) return;
    (spec.lines || []).forEach(function (l) { l.padNeed = 0; l.padTop = 0; });
    for (var it = 0; it < 3; it++) {
      reflow(spec);
      anchorPhoto(spec);
      computePads(spec);
    }
    (spec.lines || []).forEach(function (l) { l.padTop = l.padNeed || 0; });
    reflow(spec);
    anchorPhoto(spec);
  }

  /* ---------------- 主流程 ---------------- */

  /**
   * 逐行照搬原文档版式，只替换文字。
   * @param {object|Array} layouts  pdflayout.analyze 的产物（单页或多页）
   * @param {Array}  ops            ResumeInplace.collectOps(base, model)
   * @returns {object} 排版规格
   */
  function buildFlow(layouts, ops) {
    var pages = (Array.isArray(layouts) ? layouts : [layouts])
      .filter(function (p) { return p && p.lines && p.lines.length; });
    if (!pages.length) return null;
    pages.forEach(function (pg, i) { if (pg.pageIndex == null) pg.pageIndex = i; });

    // 版心统一：多页拼成一个 flow 时，所有页必须用同一套版心。
    // 左边界取各页最左；右边界以「带分隔线的页」为准 —— 分隔线精确标出版心右缘。
    var withRule = pages.filter(function (p) { return p.ruleRight > 0; });
    var base = withRule.length ? withRule[0] : pages[0];
    var globalL = Math.min.apply(null, pages.map(function (p) { return p.margin.l; }));
    var globalR = withRule.length
      ? base.margin.r
      : Math.min.apply(null, pages.map(function (p) { return p.margin.r; }));
    var pageW = pages[0].pageW;
    var contentRight = pageW - globalR;
    var margin = { l: globalL, r: globalR, t: pages[0].margin.t, b: pages[0].margin.b };

    // ① 逐页把原文档的行原样取出（保留 x / 字号 / 缩进 / 右对齐日期 / 分隔线）
    var all = [];
    pages.forEach(function (pg) {
      var raw = pg.lines.map(function (l) {
        var o = {};
        Object.keys(l).forEach(function (k) { o[k] = l[k]; });
        o._endX = l.endX || (l.x + (l.text ? l.text.length * l.size : 0));
        o.pageIndex = pg.pageIndex;
        o.origTop = l.top != null ? l.top : 0;
        o.origBottom = l.bottom != null ? l.bottom : (o.origTop + l.size * 1.2);
        o.rows = 1;
        o.innerGap = 0;
        o.textW = l.textW != null ? l.textW : estWidth(l.text, l.size);
        return o;
      });
      // 缩进统一按全局左边界重算（原文档各页左缘可能略有差异）
      raw.forEach(function (l) {
        l.indent = Math.max(0, Math.round((l.x - globalL) * 10) / 10);
      });
      // 页内：把换行拆开的同一条要点合并回来
      var merged = mergeWrapped(raw, contentRight);
      merged.forEach(function (l) {
        l.origBottom = l.origTop + l.size * 1.2;
      });
      all = all.concat(merged);
    });

    // ② 只在这里动文字：替换 / 删除 / 拆分 / 插入
    var lines = applyOps(all, ops);

    // ③ 项目符号：沿用原文档的缩进层级，把行首的「•」转成渲染用的悬挂缩进
    //    l.bullet —— 行首本来就有项目符号（要画出「•」）
    //    l.hang   —— 这一行处在缩进层里（需要悬挂缩进，但不一定有符号：
    //                比如没被合并的续行，符号在上一行已经画过了）
    var bodySize = pages[0].bodySize;
    lines.forEach(function (l) {
      var size = l.size || bodySize;
      l.size = size;
      l.natural = Math.round(size * 1.34 * 10) / 10;
      l.bullet = false;
      l.hang = false;
      if (l.indent > size * 0.55 && !l.head && !l.rule) {
        l.hang = true;
        var bm = BULLET_RE.exec(l.text);
        if (bm) {
          l.text = l.text.replace(BULLET_RE, '');
          l.bullet = true;
          // 沿用原文档的符号字形（▪ / • / · …），不要一律换成 •
          l.bulletChar = (bm[0].trim() || '•');
        }
      }
    });

    // ④ 重新估算每行的宽度与占用的物理行数
    lines.forEach(function (l) {
      l.textW = Math.round(estWidth(l.text, l.size) * 10) / 10;
      if (l.breaks && l.breaks.length) {
        l.rows = l.breaks.length + 1;
      } else {
        var avail = contentRight - l.x;
        l.rows = 1;
        if (avail > 20 && l.textW > avail) l.rows = Math.min(8, Math.ceil(l.textW / avail));
        l.innerGap = (l.rows - 1) * l.natural;
      }
    });

    return finishFlow(pages, lines, { margin: margin, contentRight: contentRight });
  }

  /**
   * 排版规格收尾。
   * 注意：这里**不做任何压缩** —— 压缩与内容裁剪的优先级由上层统一编排，
   * 否则「压行距」会被 measure() 覆盖、或在多次调用里累乘，导致版面被压扁。
   */
  function finishFlow(pages, lines, opts) {
    opts = opts || {};
    var layout = pages[0];
    var margin = opts.margin || layout.margin;
    var contentW = layout.pageW - margin.l - margin.r;
    var contentH = layout.pageH - margin.t - margin.b;

    lines.forEach(function (l) {
      var size = l.size || layout.bodySize;
      l.size = size;
      l.natural = Math.round(size * 1.34 * 10) / 10;
      if (l.gap == null) l.gap = l.natural;
    });

    var used = measure(lines);

    // 证件照：取第一页里识别到的那张（与 parse.js 的选择规则一致）
    var photo = null, photoPage = 0;
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].photo && pages[i].photo.data) { photo = pages[i].photo; photoPage = pages[i].pageIndex; break; }
    }
    var photoSpec = null;
    if (photo) {
      photoSpec = {
        x: photo.x, yTop: photo.yTop, y0: photo.yTop, w: photo.w, h: photo.h,
        ratio: photo.ratio, data: photo.data,
        pageIndex: photo.pageIndex != null ? photo.pageIndex : photoPage
      };
    }

    var spec = {
      page: { w: layout.pageW, h: layout.pageH },
      margin: margin,
      contentW: contentW,
      contentH: contentH,
      bodySize: layout.bodySize,
      fam: layout.fam,
      photo: photoSpec,
      pages: pages,
      lines: lines,
      used: Math.round(used * 10) / 10,
      fit: 1,                 // 行距收紧系数（1 = 未收紧）
      fontScale: 1,           // 字号缩放系数（1 = 未缩放）
      fits: used <= contentH + 1,
      overflow: Math.max(0, Math.round(used - contentH))
    };

    placePhoto(spec);
    spec.used = Math.round(spec.used * 10) / 10;
    return spec;
  }

  /**
   * 幂等地收紧版面：按系数 k 同时压缩行距与段前距（相对自然基线）。
   * 重复调用同一个 k 不会叠加，spec.fit 始终等于真实缩放比。
   */
  function shrink(spec, k) {
    k = Math.max(0.8, Math.min(1, k));
    spec.lines.forEach(function (l) {
      if (l.baseLineH == null) { l.baseLineH = l.lineH; l.baseGap = l.gapBefore; }
      var floor = Math.round(l.size * 1.12 * 10) / 10;   // 行距下限：1.12em，仍可读
      l.lineH = Math.max(floor, Math.round(l.baseLineH * k * 10) / 10);
      l.gapBefore = Math.round(l.baseGap * k * 10) / 10;
    });
    spec.fit = Math.round(k * 100) / 100;
    placePhoto(spec);
    return spec;
  }

  /**
   * 最后兜底：整体轻微缩字号（不动版式结构）。
   * 缩完再按当前 fit 重新推导行距，保证预览与导出完全一致。
   */
  function scaleFont(spec, s) {
    s = Math.max(0.8, Math.min(1, s));
    spec.lines.forEach(function (l) {
      l.size = Math.round(l.size * s * 100) / 100;
      l.rightSize = Math.round((l.rightSize || l.size) * s * 100) / 100;
      l.natural = Math.round(l.size * 1.34 * 10) / 10;
      if (l.baseLineH != null) {
        l.baseLineH = Math.round(l.baseLineH * s * 10) / 10;
        l.baseGap = Math.round(l.baseGap * s * 10) / 10;
      }
      if (l.innerGap) l.innerGap = Math.round(l.innerGap * s * 10) / 10;
    });
    spec.fontScale = Math.round((spec.fontScale || 1) * s * 100) / 100;
    return shrink(spec, spec.fit || 1);
  }

  var api = {
    buildFlow: buildFlow,
    shrink: shrink, scaleFont: scaleFont, norm: norm, estWidth: estWidth
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ResumeLayout = api;
})(typeof window !== 'undefined' ? window : this);

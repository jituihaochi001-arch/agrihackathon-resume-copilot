/* pdflayout.js — 从 PDF 里提取「版式参数」：页边距 / 字号 / 行距 / 缩进 / 右对齐日期 / 分隔线
   目的：让 PDF 来源也能按原文件的版式重建，而不是套用模板 */
(function (root) {
  'use strict';

  var CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

  /* 去掉 PDF 里因字距产生的「中 文 字 间 空 格」，保留中英之间的空格 */
  function tidy(s, keepSpace) {
    var out = String(s == null ? '' : s).replace(/\u00a0/g, ' ');
    if (!keepSpace) {
      // 字距造成的「中 文 间 空 格」要去掉；真正的空格由调用方按宽度判断后保留
      out = out.replace(/([\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])[ \t]+(?=[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/g, '$1');
    }
    return out
      // 连续空格是有意排出来的版式间距（例如「电话 188…    邮箱 …    上海」），
      // 只把过长的一串压到 24 个，不能全压成 1 个 —— 否则原版式被改窄了。
      .replace(/[ \t]{25,}/g, ' '.repeat(24))
      .replace(/^[ \t]+|[ \t]+$/g, '');
  }

  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    return a[Math.floor(a.length / 2)];
  }

  /**
   * 估算一段文字的真实宽度（pt）。
   * pdf.js 在拿不到嵌入字体时会把 ASCII 也按 1em 计算，宽度虚高、右端越界，
   * 于是「右对齐日期」被误判成正文的一部分 —— 这里按字符类别重新估算。
   */
  function textWidth(str, size) {
    var s = String(str == null ? '' : str);
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
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
   * 版心左缘：取「出现次数足够多的最小 x」。
   * 项目符号行的缩进（x 更大）不能当成版心左缘，否则正文会被整体右移。
   */
  function pickLeft(lefts) {
    if (!lefts.length) return 0;
    var counts = {};
    lefts.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    var need = Math.max(2, Math.ceil(lefts.length * 0.12));
    var vals = Object.keys(counts).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < vals.length; i++) {
      if (counts[vals[i]] >= need) return vals[i];
    }
    return vals[0];
  }

  function mode(arr) {
    var m = {}, best = null, bestN = 0;
    arr.forEach(function (v) {
      var k = Math.round(v * 10) / 10;
      m[k] = (m[k] || 0) + 1;
      if (m[k] > bestN) { bestN = m[k]; best = k; }
    });
    return best;
  }

  /* ---------- 文本项聚合成行 ---------- */

  function groupLines(items, pageH) {
    var rows = [];
    var sorted = items.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; });

    sorted.forEach(function (it) {
      var row = null;
      for (var i = rows.length - 1; i >= 0 && i >= rows.length - 4; i--) {
        if (Math.abs(rows[i].y - it.y) <= Math.max(2.2, it.size * 0.28)) { row = rows[i]; break; }
      }
      if (!row) {
        row = { y: it.y, items: [] };
        rows.push(row);
      }
      row.items.push(it);
    });

    rows.forEach(function (r) {
      r.items.sort(function (a, b) { return a.x - b.x; });
      r.size = Math.max.apply(null, r.items.map(function (i) { return i.size; }));
      r.x = r.items[0].x;
      r.right = r.items[r.items.length - 1].x + r.items[r.items.length - 1].w;
      r.y = r.items[0].y;
    });

    rows.sort(function (a, b) { return b.y - a.y; });
    return rows;
  }

  /** 一行内：把文字项拼成字符串，并把靠右、间距很大的尾段拆成「右侧日期」 */
  function composeLine(row, contentRight) {
    var items = row.items.slice();
    var size = row.size || 9.5;

    // 每个文字项按字符类别估算宽度（pdf.js 给的 width 在缺嵌入字体时按 1em 算，虚高）
    function wOf(it) { return textWidth(it.str, it.size || size); }

    /**
     * 找右对齐尾段。
     * 判据一：尾段与前文之间有「真实的空隙」——
     *   pdf.js 在同一个文本对象内部是按自己的宽度累加 x 的，所以同一对象内的
     *   相邻文字项间距为 0；一旦换到新的文本对象（缩进 / 制表位 / 右对齐日期），
     *   x 会直接跳到 PDF 给的绝对位置，空隙就会显现出来。
     * 判据二：尾段够短（日期、城市这类），且右端贴近版心右缘。
     */
    var splitAt = -1;
    var maxTail = Math.max(36, size * 6);
    var lastIdx = -1;
    for (var q = items.length - 1; q >= 0; q--) { if (items[q].str) { lastIdx = q; break; } }
    if (lastIdx > 0) {
      // 尾段 = 行末那一小段内容：自右向左，遇到「大空隙」就停
      var first = lastIdx;
      for (var m = lastIdx; m > 0; m--) {
        var j = m - 1;
        while (j > 0 && !items[j].str) j--;        // 前一个「有内容」的文字项
        if (j <= 0) { first = 0; break; }
        // 空隙 = 两个文字项的原始 x 距离，扣掉中间占位项的估算宽度
        var gap = (items[m].x - items[j].x - items[j].w);
        for (var t = j + 1; t < m; t++) gap -= wOf(items[t]);
        if (gap > size * 2.5) break;               // 这里就是那个大空隙 → 尾段起点
        first = j;                                // 间距正常，尾段继续向左延伸
      }
      var tailW = 0, tailEnd = 0;
      for (var u = first; u <= lastIdx; u++) {
        if (!items[u].str) continue;
        tailW += wOf(items[u]);
        tailEnd = Math.max(tailEnd, items[u].x + wOf(items[u]));
      }
      if (first > 0 && tailW <= maxTail && tailEnd >= contentRight - size * 3) splitAt = first;
    }
    var main = splitAt > 0 ? items.slice(0, splitAt) : items;
    var tail = splitAt > 0 ? items.slice(splitAt) : [];

    /** 把一段文字项拼成字符串 */
    function join(from, to) {
      var out = '';
      var prevIdx = -1;
      /** 按空隙宽度补空格：一个空格约 0.3em，最多补 4 个 */
      function spaces(n) {
        n = Math.max(1, Math.min(4, n || 1));
        return new Array(n + 1).join(' ');
      }
      for (var i2 = from; i2 < to; i2++) {
        var it = items[i2];
        // pdf.js 会把空格输出成「空字符串 + 宽度」的占位项：
        // 宽度够大 = 真正的空格；宽度很小 = 字距产生的空隙，不算内容
        if (!it.str) {
          // 占位宽度就是这段空隙的真实宽度，换算成空格个数还原版式间距
          var nsp = Math.min(24, Math.round(it.w / (size * 0.28)));
          if (nsp > 0) out += spaces(nsp);
          prevIdx = i2;
          continue;
        }
        if (prevIdx >= 0) {
          // 同一文本对象内，pdf.js 是按自己的宽度累加 x 的 → rawGap 恒为 0；
          // 只有换到新对象（制表位 / 缩进 / 右对齐）才会出现真实空隙。
          var rawGap = it.x - (items[prevIdx].x + items[prevIdx].w);
          var prevCJK = CJK.test(out.slice(-1));
          var nextCJK = CJK.test(it.str.charAt(0));
          if (rawGap > 0.5) {
            // pdf.js 在缺嵌入字体时把 ASCII 也按 1em 算宽度（虚高），
            // 真实空隙要把虚高的那部分加回来，否则版式间距会被吃掉。
            var gap = rawGap;
            if (items[prevIdx].str) {
              gap += Math.max(0, items[prevIdx].w - wOf(items[prevIdx]));
            }
            if (gap > size * 0.6) {
              // 版面上有明显间隔：按比例补空格，中文之间用全角空格占位
              if (!/\s$/.test(out)) {
                if (prevCJK && nextCJK) out += '\u3000';
                else out += spaces(Math.round(gap / (size * 0.3)));
              }
            } else if (gap > size * 0.5 && !(prevCJK && nextCJK)) {
              if (out && !/\s$/.test(out)) out += ' ';
            }
          }
        }
        out += it.str;
        prevIdx = i2;
      }
      return tidy(out, true);
    }

    var mainText = join(0, splitAt > 0 ? splitAt : items.length);
    var tailText = splitAt > 0 ? join(splitAt, items.length) : '';

    var endIdx = -1;
    for (var e = (splitAt > 0 ? splitAt : items.length) - 1; e >= 0; e--) {
      if (items[e].str) { endIdx = e; break; }
    }
    var endX = endIdx >= 0 ? Math.round((items[endIdx].x + wOf(items[endIdx])) * 10) / 10 : row.x;

    return {
      text: mainText,
      right: tailText,
      rightSize: tail.length ? tail[0].size : 0,
      x: row.x,
      y: row.y,
      size: size,
      font: (main[0] || items[0]).font,
      endX: endX,
      textW: Math.round(textWidth(mainText, size) * 10) / 10
    };
  }

  /* ---------- 分隔线 ---------- */

  function collectRules(opsList, OPS, pageH) {
    var ctm = [1, 0, 0, 1, 0, 0];
    var stack = [];
    var out = [];
    function mul(m, n) {
      return [
        m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
      ];
    }
    function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

    for (var i = 0; i < opsList.fnArray.length; i++) {
      var fn = opsList.fnArray[i], a = opsList.argsArray[i];
      if (fn === OPS.save) stack.push(ctm.slice());
      else if (fn === OPS.restore) ctm = stack.pop() || ctm;
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.constructPath) {
        var sub = a[0] || [], co = a[1] || [];
        if (sub[0] === 19) {
          var p1 = apply(ctm, co[0], co[1]);
          var p2 = apply(ctm, co[0] + co[2], co[1] + co[3]);
          var w = Math.abs(p2[0] - p1[0]), h = Math.abs(p2[1] - p1[1]);
          if (w > 60 && h < 3.2) {
            out.push({ y: p1[1], x1: Math.min(p1[0], p2[0]), w: w, thin: h });
          }
        } else {
          // 折线：找水平段
          var k = 0, start = null;
          for (var s = 0; s < sub.length; s++) {
            if (sub[s] === OPS.moveTo) { start = apply(ctm, co[k], co[k + 1]); k += 2; }
            else if (sub[s] === OPS.lineTo) {
              var p = apply(ctm, co[k], co[k + 1]); k += 2;
              if (start && Math.abs(p[1] - start[1]) < 0.8 && Math.abs(p[0] - start[0]) > 60) {
                out.push({ y: start[1], x1: Math.min(start[0], p[0]), w: Math.abs(p[0] - start[0]), thin: 0.7 });
              }
              start = p;
            } else if (sub[s] === OPS.rectangle) { k += 4; start = null; }
            else if (sub[s] === OPS.closePath) { start = null; }
          }
        }
      }
    }
    return out.map(function (r) { return { y: r.y, x: r.x1, w: r.w, thin: r.thin }; });
  }

  /* ---------- 图像（证件照）提取 ---------- */

  /** pdf.js 解码后的图像 → dataURL（兼容 ImageBitmap / 原始像素两种形态） */
  function toDataUrl(src) {
    var w = src.width, h = src.height;
    if (!w || !h) return '';
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');
    try {
      if (src.bitmap || (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap)) {
        ctx.drawImage(src.bitmap || src, 0, 0);
      } else if (src.data) {
        var kind = src.kind || 3;               // 1=1bpp 灰度 2=RGB 3=RGBA
        var out = ctx.createImageData(w, h);
        var d = src.data, o = out.data, i;
        if (kind === 3) {
          o.set(d);
        } else if (kind === 2) {
          for (i = 0; i < w * h; i++) {
            o[i * 4] = d[i * 3]; o[i * 4 + 1] = d[i * 3 + 1]; o[i * 4 + 2] = d[i * 3 + 2]; o[i * 4 + 3] = 255;
          }
        } else {
          for (i = 0; i < w * h; i++) {
            var v = d[i] ? 255 : 0;
            o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v; o[i * 4 + 3] = 255;
          }
        }
        ctx.putImageData(out, 0, 0);
      } else {
        return '';
      }
      return cv.toDataURL('image/jpeg', 0.92);
    } catch (e) {
      return '';
    }
  }

  /**
   * 从 operator list 里找出「被画出来的图片」，按 CTM 还原其版面矩形。
   * 返回 [{x, yTop, w, h, data, ratio}]，yTop 为页面顶向下的距离（pt）。
   */
  function collectImages(opsList, OPS, objs, pageH) {
    var ctm = [1, 0, 0, 1, 0, 0];
    var stack = [];
    var hits = [];
    function mul(m, n) {
      return [
        m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
      ];
    }
    function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

    function push(m) {
      var p0 = apply(m, 0, 0), px = apply(m, 1, 0), py = apply(m, 0, 1);
      var w = Math.sqrt((px[0] - p0[0]) * (px[0] - p0[0]) + (px[1] - p0[1]) * (px[1] - p0[1]));
      var h = Math.sqrt((py[0] - p0[0]) * (py[0] - p0[0]) + (py[1] - p0[1]) * (py[1] - p0[1]));
      if (!(w > 8 && h > 8)) return null;
      var xs = [p0[0], px[0], py[0], px[0] + py[0] - p0[0]];
      var ys = [p0[1], px[1], py[1], px[1] + py[1] - p0[1]];
      var left = Math.min.apply(null, xs), right = Math.max.apply(null, xs);
      var bottom = Math.min.apply(null, ys), topY = Math.max.apply(null, ys);
      return { x: left, yTop: pageH - topY, w: right - left, h: topY - bottom };
    }

    for (var i = 0; i < opsList.fnArray.length; i++) {
      var fn = opsList.fnArray[i], a = opsList.argsArray[i];
      if (fn === OPS.save) { stack.push(ctm.slice()); continue; }
      if (fn === OPS.restore) { ctm = stack.pop() || ctm; continue; }
      if (fn === OPS.transform) { ctm = mul(ctm, a); continue; }

      var src = null;
      if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject) {
        try { src = objs.get(a[0]); } catch (e) { src = null; }
        if (!src) continue;
      } else if (fn === OPS.paintInlineImageXObject) {
        src = a[0];
      } else {
        continue;
      }
      var box = push(ctm);
      if (!box) continue;
      hits.push(box);
      box.src = src;
    }

    return hits.map(function (b) {
      var data = toDataUrl(b.src);
      if (!data) return null;
      return {
        x: Math.round(b.x * 10) / 10,
        yTop: Math.round(b.yTop * 10) / 10,
        w: Math.round(b.w * 10) / 10,
        h: Math.round(b.h * 10) / 10,
        ratio: b.h / b.w,
        data: data
      };
    }).filter(Boolean);
  }

  /** 从候选图里挑证件照：竖构图、尺寸合理、位于页面上半部 */
  function pickPhoto(images, pageW, pageH) {
    var best = null, bestScore = -1;
    images.forEach(function (im) {
      if (im.w < 28 || im.w > 190 || im.h < 28 || im.h > 260) return;
      if (im.ratio < 1.12 || im.ratio > 1.72) return;
      if (im.yTop > pageH * 0.52) return;
      var score = 100 - Math.abs(im.ratio - 1.4) * 60 - (im.yTop / pageH) * 20 + (im.x / pageW) * 12;
      if (score > bestScore) { bestScore = score; best = im; }
    });
    return best;
  }

  /* ---------- 主流程：把一页的 items + rules 变成版式 ---------- */

  function analyze(pageData) {
    var pageW = pageData.width, pageH = pageData.height;
    var rows = groupLines(pageData.items, pageH);
    if (!rows.length) return null;

    // 字体使用情况：字号最大的那种字体视作「粗体/标题字体」
    var fontMax = {};
    rows.forEach(function (r) {
      r.items.forEach(function (it) {
        fontMax[it.font] = Math.max(fontMax[it.font] || 0, it.size);
      });
    });
    var displayFont = null, bestSize = 0;
    Object.keys(fontMax).forEach(function (f) {
      if (fontMax[f] > bestSize) { bestSize = fontMax[f]; displayFont = f; }
    });

    // 左边界：取「出现次数足够多的最小 x」（项目符号的缩进不算版心左缘）
    var lefts = [];
    rows.forEach(function (r) { if (r.x > 0) lefts.push(Math.round(r.x * 10) / 10); });
    var left = pickLeft(lefts);

    // 右边界：优先用「分隔线右端」——它精确标出版心右缘；
    // 没有分隔线时，退回「正文行右缘的最大值」（比中位数更接近版心），
    // 避免个别溢出的右对齐日期把边界顶到页边。
    var rules0 = pageData.rules || [];
    var ruleRight = 0;
    rules0.forEach(function (r) { ruleRight = Math.max(ruleRight, r.x + r.w); });
    var provRight = rules0.length ? Math.min(ruleRight, pageW) : pageW * 0.92;

    var contentLeft = left;

    // 字号分布
    var sizes = rows.map(function (r) { return r.size; });
    var bodySize = mode(sizes.filter(function (s) { return s < bestSize - 0.5; })) || median(sizes);

    var lines = rows.map(function (r) {
      var line = composeLine(r, provRight);
      line.size = Math.round(line.size * 100) / 100;
      line.rightSize = Math.round(line.rightSize * 100) / 100;
      line.bold = line.font === displayFont && line.size <= bodySize * 1.9;
      if (line.size >= bestSize - 0.5) line.bold = true;              // 姓名字号最大
      line.head = line.size > bodySize + 0.35 && line.text.length <= 16;
      line.indent = Math.max(0, Math.round((line.x - contentLeft) * 10) / 10);
      line.fam = r.items[0].fam || 'sans';
      // 行在页面内的纵向坐标（距页顶，pt）：用于「照片与哪一行并排」的判定
      line.top = Math.round((pageH - (line.y + line.size * 0.92)) * 10) / 10;
      line.bottom = Math.round((pageH - (line.y - line.size * 0.26)) * 10) / 10;
      return line;
    }).filter(function (l) { return l.text || l.right; });

    // 版心右缘：分隔线优先，其次正文行的最右端
    var contentRight;
    if (rules0.length) {
      contentRight = Math.min(ruleRight, pageW);
    } else {
      var maxEnd = 0;
      lines.forEach(function (l) {
        if (l.right) return;
        var e = l.x + (l.textW || 0);
        if (e > maxEnd) maxEnd = e;
      });
      contentRight = Math.max(pageW * 0.5, Math.min(maxEnd || pageW * 0.85, pageW - 24));
    }
    var right = Math.max(0, pageW - contentRight);

    // 行距：相邻行基线差
    for (var i = 0; i < lines.length; i++) {
      var prev = lines[i - 1];
      if (!prev) { lines[i].gap = 0; continue; }
      lines[i].gap = Math.round((prev.y - lines[i].y) * 10) / 10;
      if (!(lines[i].gap > 0)) lines[i].gap = Math.round(lines[i].size * 1.6);
    }

    // 分隔线挂到紧邻其上的那一行
    var rules = pageData.rules || [];
    rules.forEach(function (rule) {
      var mark = null, markD = 99;
      lines.forEach(function (l) {
        var d = l.y - rule.y;                    // 线在基线下方时为正值
        if (d > -1.5 && d < 15 && d < markD) { markD = d; mark = l; }
      });
      if (mark) {
        mark.rule = true;
        mark.ruleW = rule.w;
        mark.ruleX = Math.round((rule.x - contentLeft) * 10) / 10;
        mark.ruleOffset = markD;
      }
    });

    var top = pageH - (lines[0].y + lines[0].size * 0.92);
    // 底部留白：取左右边距的常规值，避免「内容没写满」被当成版心高度
    var bottom = Math.round(Math.min(left, right));

    return {
      pageW: Math.round(pageW * 100) / 100,
      pageH: Math.round(pageH * 100) / 100,
      margin: {
        l: Math.round(contentLeft * 10) / 10,
        r: Math.round(right * 10) / 10,
        t: Math.round(Math.max(24, top) * 10) / 10,
        b: Math.max(24, bottom)
      },
      contentLeft: Math.round(contentLeft * 10) / 10,
      contentRight: Math.round(contentRight * 10) / 10,
      ruleRight: Math.round(ruleRight * 10) / 10,
      bodySize: Math.round(bodySize * 100) / 100,
      displaySize: Math.round(bestSize * 100) / 100,
      fam: lines[0].fam === 'serif' ? 'serif' : 'sans',
      photo: pickPhoto(pageData.images || [], pageW, pageH),
      lines: lines
    };
  }

  var api = {
    analyze: analyze, tidy: tidy, collectRules: collectRules,
    collectImages: collectImages, pickPhoto: pickPhoto,
    textWidth: textWidth, pickLeft: pickLeft
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ResumePdfLayout = api;
})(typeof window !== 'undefined' ? window : this);

/* pdfwrite.js — 把预览里的成稿 DOM 直接写成矢量 PDF，在浏览器内下载，不经过打印对话框
 *
 * 做法：
 *   1) 走一遍预览 DOM，量出每个文字行 / 色块 / 边框 / 图片的真实位置（换算成 PDF 点）
 *   2) 把用到的汉字从内置的 Noto Sans SC 子集里再裁一次，只嵌进 PDF 需要的字形
 *   3) 用 Type0 / Identity-H + CIDFontType2 把字写进内容流，附带 ToUnicode（可复制可检索）
 *
 * 关键点：预览与导出共用同一份 DOM，所见即所得——排版、照片、颜色都照抄预览。
 */
(function (root) {
  'use strict';

  var A4_W = 595.276, A4_H = 841.89;   // A4 点尺寸
  var PX2PT = 0.75;                    // CSS px → pt
  var PAGE_H = A4_H / PX2PT;           // 每页高度（布局 px，约 1122.52）

  /* ================= 1. PDF 底层写入 ================= */

  function b(s) {
    var u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff;
    return u;
  }
  function cat(list) {
    var n = 0, i;
    for (i = 0; i < list.length; i++) n += list[i].length;
    var out = new Uint8Array(n), p = 0;
    for (i = 0; i < list.length; i++) { out.set(list[i], p); p += list[i].length; }
    return out;
  }
  function num(n) {
    if (!isFinite(n)) n = 0;
    var v = Math.round(n * 1000) / 1000;
    return String(v);
  }
  function hex4(n) {
    var s = (n >>> 0).toString(16).toUpperCase();
    while (s.length < 4) s = '0' + s;
    return s;
  }
  function hexs(codes) {
    var s = '';
    for (var i = 0; i < codes.length; i++) s += (i ? ' ' : '') + hex4(codes[i]);
    return '<' + s + '>';
  }
  function pdfStr(s) {
    return String(s == null ? '' : s).replace(/([\\()])/g, '\\$1');
  }

  function Doc() { this.objs = []; }
  Doc.prototype.add = function (body) {
    this.objs.push(typeof body === 'string' ? b(body) : body);
    return this.objs.length;
  };
  Doc.prototype.reserve = function () { this.objs.push(null); return this.objs.length; };
  Doc.prototype.set = function (num_, body) {
    this.objs[num_ - 1] = typeof body === 'string' ? b(body) : body;
  };
  Doc.prototype.stream = function (dict, data) {
    var head = b('<< ' + dict + ' /Length ' + data.length + ' >>\nstream\n');
    var tail = b('\nendstream');
    var out = new Uint8Array(head.length + data.length + tail.length);
    out.set(head, 0);
    out.set(data, head.length);
    out.set(tail, head.length + data.length);
    return this.add(out);
  };
  Doc.prototype.serialize = function (rootNum, infoNum) {
    var parts = [], offsets = [0], pos = 0, i;
    parts.push(b('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n'));
    pos += 14;
    for (i = 0; i < this.objs.length; i++) {
      var body = this.objs[i] || b('null');
      var head = b((i + 1) + ' 0 obj\n');
      var tail = b('\nendobj\n');
      offsets.push(pos);
      parts.push(head); pos += head.length;
      parts.push(body); pos += body.length;
      parts.push(tail); pos += tail.length;
    }
    var xrefPos = pos;
    var xr = b('xref\n0 ' + (this.objs.length + 1) + '\n0000000000 65535 f \n');
    for (i = 1; i <= this.objs.length; i++) {
      xr = cat([xr, b(pad10(offsets[i]) + ' 00000 n \n')]);
    }
    parts.push(xr); pos += xr.length;
    parts.push(b('trailer\n<< /Size ' + (this.objs.length + 1) + ' /Root ' + rootNum + ' 0 R' +
      (infoNum ? ' /Info ' + infoNum + ' 0 R' : '') + ' >>\nstartxref\n' + xrefPos + '\n%%EOF\n'));
    return cat(parts);
  };
  function pad10(n) { var s = String(n); while (s.length < 10) s = '0' + s; return s; }

  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined' || !bytes || !bytes.length) return null;
    try {
      var cs = new CompressionStream('deflate');
      var stream = new Blob([bytes]).stream().pipeThrough(cs);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }

  function b64ToBytes(s) {
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  /* ================= 2. 内置中文字体 ================= */

  var fontPromise = null;
  function loadCjkFont() {
    if (fontPromise) return fontPromise;
    fontPromise = (async function () {
      if (!root.__CJK_TTF_Z) {
        var url = new URL('vendor/cjkfont.js', document.baseURI || location.href).href;
        await new Promise(function (res, rej) {
          var s = document.createElement('script');
          s.src = url;
          s.onload = res;
          s.onerror = function () { rej(new Error('中文字体资源加载失败')); };
          document.head.appendChild(s);
        });
      }
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('当前浏览器不支持 DecompressionStream，无法内嵌中文字体');
      }
      var raw = b64ToBytes(root.__CJK_TTF_Z);
      var ds = new DecompressionStream('deflate');
      var buf = await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer();
      return buf;
    })();
    return fontPromise;
  }

  /** 从 TTF 里读出度量信息 */
  function fontMetrics(buf) {
    var t = root.ResumeTTF.parseTables(buf);
    var dv = new DataView(buf);
    var head = t.tables.head, hhea = t.tables.hhea;
    return {
      upem: dv.getUint16(head.offset + 18, false),
      bbox: [
        dv.getInt16(head.offset + 36, false), dv.getInt16(head.offset + 38, false),
        dv.getInt16(head.offset + 40, false), dv.getInt16(head.offset + 42, false)
      ],
      asc: dv.getInt16(hhea.offset + 4, false),
      desc: dv.getInt16(hhea.offset + 6, false)
    };
  }

  /* ================= 3. 采集 DOM 版面 ================= */

  function parseColor(c) {
    if (!c) return null;
    if (c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return null;
    var m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    if (p.length < 3) return null;
    if (p.length === 4 && p[3] < 0.05) return null;
    return [p[0] / 255, p[1] / 255, p[2] / 255];
  }

  var mctx = null;
  function metricsOf(cs) {
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    var size = parseFloat(cs.fontSize) || 12;
    try {
      mctx.font = (cs.fontStyle || 'normal') + ' ' + (cs.fontWeight || 'normal') + ' ' +
        size + 'px ' + (cs.fontFamily || 'sans-serif');
      var tm = mctx.measureText('汉Ag');
      if (tm.fontBoundingBoxAscent && tm.fontBoundingBoxDescent) {
        return { ascent: tm.fontBoundingBoxAscent, descent: tm.fontBoundingBoxDescent };
      }
    } catch (e) { /* 忽略 */ }
    return { ascent: size * 0.88, descent: size * 0.22 };
  }

  /** 取文本节点第 i 个字符所在行的 top（用于切分行） */
  function topAt(node, i) {
    if (i <= 0) return -Infinity;
    var r = document.createRange();
    r.setStart(node, 0);
    r.setEnd(node, i);
    var rects = r.getClientRects();
    if (!rects.length) return -Infinity;
    return rects[rects.length - 1].top;
  }

  /** 把一个文本节点按视觉行切开 */
  function splitLines(node) {
    var text = node.nodeValue;
    var n = text.length;
    if (!n) return [];
    var range = document.createRange();
    range.selectNodeContents(node);
    var rects = range.getClientRects();
    var ls = [];
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (r.height <= 0 || r.width <= 0) continue;
      var last = ls[ls.length - 1];
      if (last && Math.abs(last.top - r.top) < Math.max(2, r.height * 0.45)) {
        last.left = Math.min(last.left, r.left);
        last.right = Math.max(last.right, r.right);
        last.bottom = Math.max(last.bottom, r.bottom);
        last.top = Math.min(last.top, r.top);
      } else {
        ls.push({ top: r.top, left: r.left, right: r.right, bottom: r.bottom });
      }
    }
    if (!ls.length) return [];

    // 每行的字符边界（二分）
    var bounds = [0], lo = 0;
    for (var k = 0; k < ls.length - 1; k++) {
      var a = lo, bb = n;
      while (a < bb) {
        var mid = (a + bb + 1) >> 1;
        if (topAt(node, mid) <= ls[k].top + 1.5) a = mid; else bb = mid - 1;
      }
      lo = a;
      bounds.push(a);
    }
    bounds.push(n);

    var out = [];
    for (var j = 0; j < ls.length; j++) {
      var s = bounds[j], e = bounds[j + 1];
      if (e <= s) continue;
      out.push({
        text: text.slice(s, e), start: s, end: e,
        left: ls[j].left, right: ls[j].right,
        top: ls[j].top, bottom: ls[j].bottom
      });
    }
    return out;
  }

  function addBorders(cs, box, ops) {
    var sides = [
      ['borderTopWidth', 'borderTopStyle', 'borderTopColor', 0],
      ['borderRightWidth', 'borderRightStyle', 'borderRightColor', 1],
      ['borderBottomWidth', 'borderBottomStyle', 'borderBottomColor', 2],
      ['borderLeftWidth', 'borderLeftStyle', 'borderLeftColor', 3]
    ];
    sides.forEach(function (s) {
      var w = parseFloat(cs[s[0]]) || 0;
      if (w <= 0 || cs[s[1]] === 'none' || cs[s[1]] === 'hidden') return;
      var col = parseColor(cs[s[2]]);
      if (!col) return;
      var x = box.x, y = box.y, ww = box.w, hh = box.h;
      if (s[3] === 0) { hh = w; }
      else if (s[3] === 2) { y = box.y + box.h - w; hh = w; }
      else if (s[3] === 3) { ww = w; }
      else { x = box.x + box.w - w; ww = w; }
      ops.push({ t: 'rect', x: x, y: y, w: ww, h: hh, fill: col });
    });
  }

  function collectScene(paper) {
    var pr = paper.getBoundingClientRect();
    var layoutW = paper.offsetWidth || pr.width || A4_W;
    var scale = pr.width ? pr.width / layoutW : 1;
    var K = PX2PT;                        // 布局 px → pt（rect 已除过缩放比）
    var ops = [];
    var chars = Object.create(null);

    function rel(r) {
      return {
        x: (r.left - pr.left) / scale,
        y: (r.top - pr.top) / scale,
        w: r.width / scale,
        h: r.height / scale
      };
    }

    function addText(node, cs) {
      var raw = node.nodeValue;
      if (!raw || !raw.trim()) return;
      var lines = splitLines(node);
      if (!lines.length) return;
      var m = metricsOf(cs);
      var sizePx = parseFloat(cs.fontSize) || 12;
      var sizePt = sizePx * PX2PT;
      var color = parseColor(cs.color) || [0, 0, 0];
      var bold = (parseInt(cs.fontWeight, 10) || 400) >= 600;
      var rng = document.createRange();
      // 视口坐标 → 相对纸张左上角的布局坐标
      var LX = function (v) { return (v - pr.left) / scale; };
      var LY = function (v) { return (v - pr.top) / scale; };

      lines.forEach(function (ln) {
        var slice = raw.slice(ln.start, ln.end);
        var arr = Array.from(slice);
        var list = [], pos = ln.start;
        for (var k = 0; k < arr.length; k++) {
          var ch = arr[k];
          if (ch === '\n' || ch === '\r') { pos += ch.length; continue; }
          var len = ch.length;
          var x = LX(ln.left), w = 0;
          try {
            rng.setStart(node, pos);
            rng.setEnd(node, pos + len);
            var cr = rng.getBoundingClientRect();
            if (cr.width || cr.height) { x = LX(cr.left); w = cr.width / scale; }
          } catch (e) { /* 保持行首位置 */ }
          list.push({ cp: ch.codePointAt(0), x: x, w: w });
          pos += len;
        }
        if (!list.length) return;
        list.forEach(function (c) { chars[c.cp] = 1; });
        ops.push({
          t: 'text', chars: list, x: list[0].x,
          y: LY(ln.bottom) - m.descent,
          size: sizePt, sizePx: sizePx, color: color, bold: bold,
          fam: cs.fontFamily || 'sans-serif'
        });
      });
    }

    function walk(el) {
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if (parseFloat(cs.opacity) === 0) return;
      var r = el.getBoundingClientRect();
      var box = rel(r);

      var bg = parseColor(cs.backgroundColor);
      if (bg && box.w > 0 && box.h > 0) {
        ops.push({ t: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, fill: bg });
      }
      addBorders(cs, box, ops);

      if (el.tagName === 'IMG') {
        var src = el.getAttribute('src');
        if (src && src.indexOf('data:') === 0) {
          ops.push({ t: 'img', src: src, x: box.x, y: box.y, w: box.w, h: box.h });
        }
        return;
      }
      var kids = el.childNodes;
      for (var i = 0; i < kids.length; i++) {
        var nd = kids[i];
        if (nd.nodeType === 3) addText(nd, cs);
        else if (nd.nodeType === 1) walk(nd);
      }
    }

    walk(paper);
    return { ops: ops, chars: chars, K: K };
  }

  /* ================= 4. 图片 ================= */

  function loadJpeg(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width;
          c.height = img.naturalHeight || img.height;
          if (!c.width || !c.height) { resolve(null); return; }
          c.getContext('2d').drawImage(img, 0, 0);
          var url = c.toDataURL('image/jpeg', 0.92);
          var m = /^data:image\/jpeg;base64,(.*)$/.exec(url);
          if (!m) { resolve(null); return; }
          resolve({ w: c.width, h: c.height, data: b64ToBytes(m[1]) });
        } catch (e) { resolve(null); }
      };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  async function collectImages(ops, doc) {
    var refs = {}, list = [];
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.t !== 'img' || !op.src) continue;
      if (refs[op.src]) continue;
      var img = await loadJpeg(op.src);
      if (!img) continue;
      var n = doc.stream('/Type /XObject /Subtype /Image /Width ' + img.w + ' /Height ' + img.h +
        ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode', img.data);
      var ref = { name: 'Im' + (list.length + 1), num: n };
      refs[op.src] = ref;
      list.push(ref);
    }
    return refs;
  }

  /* ================= 5. 内容流 ================= */

  /**
   * 把场景里落在某一页上的图元写成内容流。
   * pageTop 是该页在整份纸面上的纵向起点（布局 px）；超出的部分由 PDF 页面边界自然裁掉。
   */
  function buildContent(ops, F, imgRefs, pageTop) {
    var parts = [], K = F.K;
    var p = function (s) { parts.push(b(s)); };
    // PDF 的文本状态跨 BT/ET 保留，Tc/Tz 等必须自己记住当前值
    var curTz = 100;
    var top = pageTop || 0, bottom = top + PAGE_H;

    ops.forEach(function (op) {
      if (op.t === 'rect' || op.t === 'img') {
        if (op.y + op.h <= top || op.y >= bottom) return;
      } else if (op.t === 'text') {
        if (op.y < top || op.y >= bottom) return;
      }

      if (op.t === 'rect') {
        p('q\n' + num(op.fill[0]) + ' ' + num(op.fill[1]) + ' ' + num(op.fill[2]) + ' rg\n');
        p(num(op.x * K) + ' ' + num(A4_H - (op.y - top + op.h) * K) + ' ' +
          num(op.w * K) + ' ' + num(op.h * K) + ' re\nf\nQ\n');
      } else if (op.t === 'img') {
        var ref = imgRefs[op.src];
        if (!ref) return;
        p('q\n' + num(op.w * K) + ' 0 0 ' + num(op.h * K) + ' ' +
          num(op.x * K) + ' ' + num(A4_H - (op.y - top + op.h) * K) + ' cm\n');
        p('/' + ref.name + ' Do\nQ\n');
      } else if (op.t === 'text') {
        var size = op.size;
        if (!size || !op.chars.length) return;
        var y = A4_H - (op.y - top) * K;
        p('BT\n/F1 ' + num(size) + ' Tf\n');
        p(num(op.color[0]) + ' ' + num(op.color[1]) + ' ' + num(op.color[2]) + ' rg\n');
        // 加粗：同一字形错开一点点重绘一次（比 Tr 描边更稳，不受阅读器缩放规则影响）
        var dx = op.bold ? size * 0.026 : 0;
        op.chars.forEach(function (c) {
          var cid = F.gidOf[c.cp];
          if (cid === undefined || cid === 0) return;      // 字体里没有的字直接跳过
          var pdfAdv = (F.widths[cid] || 0) / F.upem * size;   // pt
          var domAdv = c.w * K;                                 // pt
          var x = c.x * K;
          var tz = 100;
          if (domAdv > 0.01 && pdfAdv > 0.01) {
            if (pdfAdv > domAdv) {
              // PDF 里的字形更宽（如全角圆点）：不拉伸，按墨迹居中往左挪
              x -= (pdfAdv - domAdv) / 2;
            } else {
              // PDF 里的字形更窄：横向拉伸，正好占满浏览器里的字宽，避免字间空隙
              var r = domAdv / pdfAdv * 100;
              tz = r < 25 ? 25 : (r > 400 ? 400 : r);
            }
          }
          if (Math.abs(tz - curTz) > 0.01) { p(num(tz) + ' Tz\n'); curTz = tz; }
          p('1 0 0 1 ' + num(x) + ' ' + num(y) + ' Tm\n');
          p(hexs([cid]) + ' Tj\n');
          if (dx) {
            p('1 0 0 1 ' + num(x + dx) + ' ' + num(y) + ' Tm\n');
            p(hexs([cid]) + ' Tj\n');
          }
        });
        p('ET\n');
      }
    });
    return cat(parts);
  }

  /* ================= 6. 字体对象 ================= */

  function toUnicodeCMap(gidOf, used) {
    // 一个字形可能对应多个码位（如 Noto 里 • 与 ・ 共用字形），
    // ToUnicode 里同一个 CID 只能有一条记录，否则复制出来的文字会串码。
    var byCid = Object.create(null);
    if (used) {
      Object.keys(used).forEach(function (cp) {
        var g = gidOf[cp];
        if (g === undefined) return;
        if (byCid[g] === undefined) byCid[g] = Number(cp);
      });
    }
    Object.keys(gidOf).forEach(function (cp) {
      var g = gidOf[cp];
      if (byCid[g] === undefined) byCid[g] = Number(cp);
    });
    var pairs = [];
    Object.keys(byCid).forEach(function (g) { pairs.push([Number(g), byCid[g]]); });
    pairs.sort(function (a, c) { return a[0] - c[0]; });
    var chunks = [];
    for (var i = 0; i < pairs.length; i += 100) {
      var slice = pairs.slice(i, i + 100);
      var lines = slice.map(function (p) { return '<' + hex4(p[0]) + '> <' + hex4(p[1]) + '>'; });
      chunks.push(slice.length + ' beginbfchar\n' + lines.join('\n') + '\nendbfchar');
    }
    return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo <</Registry (Adobe) /Ordering (UCS) /Supplement 0>> def\n' +
      '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
      chunks.join('\n') + '\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
  }

  async function buildFont(doc, sub, fm, used) {
    var gidOf = sub.gidOf, widths = sub.widths, upem = sub.upem;

    // /W 宽度数组
    var gids = Object.keys(widths).map(Number).sort(function (a, c) { return a - c; });
    var groups = [], i = 0;
    while (i < gids.length) {
      var start = gids[i], list = [], j = i;
      while (j < gids.length && gids[j] === start + (j - i)) {
        list.push(Math.round((widths[gids[j]] || 0) * 1000 / upem));
        j++;
      }
      groups.push(start + ' [' + list.join(' ') + ']');
      i = j;
    }
    var W = groups.length ? ('/W [' + groups.join(' ') + ']') : '';

    // FontFile2
    var ttfBytes = new Uint8Array(sub.buffer);
    var packed = await deflate(ttfBytes);
    var fileDict = '/Length1 ' + ttfBytes.length + (packed ? ' /Filter /FlateDecode' : '');
    var ffNum = doc.stream(fileDict, packed || ttfBytes);

    var name = 'NotoSansSC';
    var fdNum = doc.add('<< /Type /FontDescriptor /FontName /' + name +
      ' /Flags 4 /FontBBox [' + fm.bbox.map(num).join(' ') + '] /ItalicAngle 0' +
      ' /Ascent ' + num(fm.asc) + ' /Descent ' + num(fm.desc) +
      ' /CapHeight ' + num(fm.asc) + ' /StemV 80 /FontFile2 ' + ffNum + ' 0 R >>');

    var cidNum = doc.add('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + name +
      ' /CIDSystemInfo <</Registry (Adobe) /Ordering (Identity) /Supplement 0>>' +
      ' /FontDescriptor ' + fdNum + ' 0 R /DW 1000 ' + W + ' /CIDToGIDMap /Identity >>');

    var touBytes = b(toUnicodeCMap(gidOf, used));
    var touNum = doc.stream('', touBytes);

    return doc.add('<< /Type /Font /Subtype /Type0 /BaseFont /' + name +
      ' /Encoding /Identity-H /DescendantFonts [' + cidNum + ' 0 R] /ToUnicode ' + touNum + ' 0 R >>');
  }

  /* ================= 7. 对外接口 ================= */

  async function build(paper, opts) {
    opts = opts || {};
    if (!paper) throw new Error('没有可导出的成稿');
    var scene = collectScene(paper);
    if (!scene.ops.length) throw new Error('成稿内容为空，无法生成 PDF');

    var ttfBuf = await loadCjkFont();
    var codes = Object.keys(scene.chars).map(Number);
    var sub = root.ResumeTTF.subset(ttfBuf, codes);
    var fm = fontMetrics(sub.buffer);

    var doc = new Doc();
    var imgRefs = await collectImages(scene.ops, doc);

    // 按 A4 高度切页：纸面超过一页时逐页生成内容流（跨页的色块/图片由页面边界裁切）
    var contentH = PAGE_H;
    scene.ops.forEach(function (op) {
      var bot = op.t === 'text' ? (op.y + (op.sizePx || 0)) : (op.y + (op.h || 0));
      if (bot > contentH) contentH = bot;
    });
    if (paper.scrollHeight && paper.scrollHeight > contentH) contentH = paper.scrollHeight;
    var pageTotal = Math.max(1, Math.ceil((contentH - 1) / PAGE_H));

    var contentNums = [];
    for (var pi = 0; pi < pageTotal; pi++) {
      var content = buildContent(scene.ops, {
        K: scene.K, gidOf: sub.gidOf, widths: sub.widths, upem: sub.upem
      }, imgRefs, pi * PAGE_H);
      var packed = await deflate(content);
      contentNums.push(doc.stream(packed ? '/Filter /FlateDecode' : '', packed || content));
    }

    var fontNum = await buildFont(doc, sub, fm, scene.chars);

    var res = '/Font << /F1 ' + fontNum + ' 0 R >>';
    var xo = Object.keys(imgRefs).map(function (k) {
      var r = imgRefs[k];
      return '/' + r.name + ' ' + r.num + ' 0 R';
    });
    if (xo.length) res += ' /XObject << ' + xo.join(' ') + ' >>';

    var pagesNum = doc.reserve();
    var kidNums = contentNums.map(function (cn) {
      return doc.add('<< /Type /Page /Parent ' + pagesNum + ' 0 R /MediaBox [0 0 ' +
        num(A4_W) + ' ' + num(A4_H) + '] /Resources << ' + res + ' >> /Contents ' +
        cn + ' 0 R >>');
    });
    doc.set(pagesNum, '<< /Type /Pages /Kids [' +
      kidNums.map(function (n) { return n + ' 0 R'; }).join(' ') + '] /Count ' + pageTotal + ' >>');
    var catNum = doc.add('<< /Type /Catalog /Pages ' + pagesNum + ' 0 R >>');
    var infoNum = doc.add('<< /Producer (ResumePolish) /Creator (ResumePolish) /Title (' +
      pdfStr(opts.title || '简历') + ') /CreationDate (D:' +
      new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + ') >>');

    return doc.serialize(catNum, infoNum);
  }

  root.ResumePdf = { build: build, collectScene: collectScene };
})(typeof window !== 'undefined' ? window : this);

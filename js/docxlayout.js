/* docxlayout.js — 按「原文件版式规格」直接生成 .docx（字号 / 行距 / 缩进 / 分隔线 / 右对齐日期全部沿用原件） */
(function (root) {
  'use strict';

  var A4W = 11906, A4H = 16838;   // twips

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function tw(pt) { return Math.round((pt || 0) * 20); }

  function fontsFor(fam) {
    return fam === 'serif'
      ? { ea: '宋体', ascii: 'Times New Roman' }
      : { ea: '微软雅黑', ascii: 'Arial' };
  }

  function run(text, o) {
    o = o || {};
    var f = o.fonts;
    var rPr = '<w:rPr><w:rFonts w:ascii="' + f.ascii + '" w:hAnsi="' + f.ascii +
      '" w:eastAsia="' + f.ea + '" w:cs="' + f.ascii + '"/>';
    if (o.b) rPr += '<w:b/><w:bCs/>';
    rPr += '<w:color w:val="' + (o.color || '101214') + '"/>';
    rPr += '<w:sz w:val="' + Math.round((o.size || 9.5) * 2) + '"/><w:szCs w:val="' + Math.round((o.size || 9.5) * 2) + '"/>';
    rPr += '</w:rPr>';
    if (o.tab) return '<w:r>' + rPr + '<w:tab/></w:r>';
    return '<w:r>' + rPr + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>';
  }

  /* ---------------- 证件照（按原 PDF 位置与尺寸浮动贴回） ---------------- */

  var EMU = 12700;              // 1pt = 12700 EMU

  /** data URL → { ext, mime, bytes } */
  function photoFile(dataUrl) {
    var m = String(dataUrl || '').match(/^data:(image\/[a-z+]+);base64,([\s\S]+)$/i);
    if (!m) return null;
    var mime = m[1].toLowerCase();
    var ext = mime === 'image/png' ? 'png' : (mime === 'image/gif' ? 'gif' : 'jpg');
    var bin = atob(m[2]);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { ext: ext, mime: mime, bytes: u8 };
  }

  /**
   * 浮动图片锚点：以「页面」为基准按绝对坐标定位，
   * 与原 PDF 中照片的位置（x / yTop，单位 pt）完全一致。
   * behindDoc=1 + wrapNone：照片浮在文字下方，正文照常排版，不会被挤开。
   */
  function photoAnchor(rid, name, ph) {
    var cx = Math.round(ph.w * EMU);
    var cy = Math.round(ph.h * EMU);
    var offX = Math.round(ph.x * EMU);
    var offY = Math.round(ph.yTop * EMU);
    return '<w:r><w:drawing>' +
      '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="2" ' +
      'behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/>' +
      '<wp:positionH relativeFrom="page"><wp:posOffset>' + offX + '</wp:posOffset></wp:positionH>' +
      '<wp:positionV relativeFrom="page"><wp:posOffset>' + offY + '</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/>' +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      '<wp:wrapNone/>' +
      '<wp:docPr id="101" name="' + name + '" descr="证件照"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="101" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
  }

  /* ---------------- 原版式（绘制原语）→ DOCX ---------------- */

  /** PDF 字体名 → Word 字体 */
  function docxFonts(base) {
    var n = String(base || '').replace(/^[A-Z]{6}\+/i, '');
    if (/simsun|宋体|songti|noto serif|source han serif/i.test(n)) return { ea: '宋体', ascii: 'Times New Roman' };
    if (/simhei|黑体|heiti/i.test(n)) return { ea: '黑体', ascii: 'Arial' };
    if (/kaiti|楷体/i.test(n)) return { ea: '楷体', ascii: 'Times New Roman' };
    if (/fangsong|仿宋/i.test(n)) return { ea: '仿宋', ascii: 'Times New Roman' };
    if (/times/i.test(n)) return { ea: '宋体', ascii: 'Times New Roman' };
    if (/arial|helvetica/i.test(n)) return { ea: '微软雅黑', ascii: 'Arial' };
    return { ea: '微软雅黑', ascii: 'Arial' };
  }

  function hex6(c) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
    return m ? m[1].toUpperCase() : '101214';
  }

  /**
   * 按「绘制原语」生成 .docx：
   *   · 灰底通栏 → 段落的底纹（w:shd）
   *   · 标题左侧黑色竖条 → 段落左边框（w:pBdr/w:left）
   *   · 中英文双色双字号 → 两个 run，各自的字号与颜色
   *   · 三列并排 / 右侧日期列 → 制表位（w:tabs）
   *   · 证件照 → 按原 PDF 坐标浮动贴回
   */
  function buildPaint(spec) {
    var pages = (spec && spec.pages) || [];
    if (!pages.length) return null;

    var body = [];
    var photo = null, photoRun = '';

    pages.forEach(function (pg, pi) {
      var runs = (pg.runs || []).slice().sort(function (a, b) {
        return (b.y - a.y) || (a.x - b.x);
      });
      if (!runs.length) return;

      // 版心：左边距取最左侧的色块 / 文字，上边距取最高的内容
      var ml = Infinity, mt = Infinity;
      (pg.rects || []).forEach(function (r) { if (r.x < ml) ml = r.x; });
      runs.forEach(function (r) { if (r.x < ml) ml = r.x; if (r.y < mt) mt = r.y; });
      (pg.images || []).forEach(function (im) { if (im.yTop < mt) mt = im.yTop; });
      if (!isFinite(ml)) ml = 36;
      if (!isFinite(mt)) mt = 36;

      // 按基线分行
      var lines = [];
      runs.forEach(function (r) {
        var cur = null;
        for (var i = 0; i < lines.length; i++) {
          if (Math.abs(lines[i].y - r.y) <= Math.max(0.8, r.size * 0.4)) { cur = lines[i]; break; }
        }
        if (!cur) { cur = { y: r.y, items: [] }; lines.push(cur); }
        cur.items.push(r);
      });
      lines.sort(function (a, b) { return a.y - b.y; });

      // 灰底通栏：找出所有「扁而宽」的浅色块
      var bands = (pg.rects || []).filter(function (r) {
        return r.h > 6 && r.w > 120;
      });
      var bars = (pg.rects || []).filter(function (r) {
        return r.h > 6 && r.w < 12;
      });

      var prevY = null;
      lines.forEach(function (ln) {
        ln.items.sort(function (a, b) { return a.x - b.x; });
        var first = ln.items[0];
        var delta = prevY == null ? Math.max(10, first.size * 1.25) : (ln.y - prevY);
        if (delta < 4) delta = Math.max(4, first.size);
        prevY = ln.y;

        var pPr = '<w:pPr>';

        // 命中灰底通栏 → 底纹 + 左侧竖条
        var band = null, bar = null;
        bands.forEach(function (b) {
          if (ln.y >= b.y - 2 && ln.y <= b.y + b.h + 2) band = b;
        });
        bars.forEach(function (b) {
          if (ln.y >= b.y - 2 && ln.y <= b.y + b.h + 2) bar = b;
        });
        if (band) {
          pPr += '<w:shd w:val="clear" w:color="auto" w:fill="' + hex6(band.fill) + '"/>';
        }
        if (bar) {
          var space = Math.max(0, Math.round((first.x - (bar.x + bar.w)) * 20));
          pPr += '<w:pBdr><w:left w:val="single" w:sz="' +
            Math.max(2, Math.round(bar.w * 8)) + '" w:space="' + space + '" w:color="' + hex6(bar.fill) + '"/></w:pBdr>';
        }

        pPr += '<w:spacing w:before="0" w:after="0" w:line="' + tw(delta) + '" w:lineRule="exact"/>';

        // 缩进：首段的 x 相对左边距
        var indent = Math.max(0, first.x - ml);
        if (indent > 0.5) pPr += '<w:ind w:left="' + tw(indent) + '"/>';

        // 制表位：同一行里其余段落的 x 位置
        var tabs = '', needTabs = false;
        ln.items.forEach(function (r, k) {
          if (k === 0) return;
          var pos = Math.max(0, r.x - ml);
          tabs += '<w:tab w:val="left" w:pos="' + tw(pos) + '"/>';
          needTabs = true;
        });
        if (needTabs) pPr += '<w:tabs>' + tabs + '</w:tabs>';

        pPr += '<w:jc w:val="left"/><w:snapToGrid w:val="0"/></w:pPr>';

        var rs = '';
        ln.items.forEach(function (r, k) {
          var f = docxFonts(r.base);
          var bold = /bold|black|heavy|semibold/i.test(String(r.base || ''));
          if (k > 0) rs += run('', { fonts: f, size: r.size, color: hex6(r.color), tab: true });
          rs += run(r.text, { fonts: f, size: r.size, b: bold, color: hex6(r.color) });
        });
        body.push('<w:p>' + pPr + rs + '</w:p>');
      });

      // 证件照：按原 PDF 的坐标与尺寸浮动贴回
      (pg.images || []).forEach(function (im) {
        if (!im.data || photo) return;
        photo = photoFile(im.data);
        if (photo) photoRun = photoAnchor('rIdPhoto', 'photo.' + photo.ext, im);
      });

      if (pi > 0) body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
    });

    // 照片锚点挂在正文第一个段落里，避免额外占一行高度
    if (photoRun && body.length) {
      var first = body[0];
      var at = first.indexOf('</w:pPr>');
      if (at >= 0) body[0] = first.slice(0, at + 8) + photoRun + first.slice(at + 8);
      else body[0] = first.replace('<w:p>', '<w:p>' + photoRun);
    }

    var pg0 = pages[0];
    var marginL = 36, marginT = 36, marginR = 36, marginB = 36;
    (function () {
      var ml = Infinity, mt = Infinity, mr = -Infinity;
      (pg0.rects || []).forEach(function (r) {
        if (r.x < ml) ml = r.x;
        if (r.x + r.w > mr) mr = r.x + r.w;
      });
      (pg0.runs || []).forEach(function (r) {
        if (r.x < ml) ml = r.x;
        if (r.y < mt) mt = r.y;
        if (r.x + r.w > mr) mr = r.x + r.w;
      });
      if (isFinite(ml)) marginL = ml;
      if (isFinite(mt)) marginT = Math.max(12, mt - 12);
      if (isFinite(mr)) marginR = Math.max(12, pg0.width - mr);
    })();

    var sectPr = '<w:sectPr><w:pgSz w:w="' + A4W + '" w:h="' + A4H + '"/>' +
      '<w:pgMar w:top="' + tw(marginT) + '" w:right="' + tw(marginR) + '" w:bottom="' + tw(marginB) +
      '" w:left="' + tw(marginL) + '" w:header="720" w:footer="720" w:gutter="0"/>' +
      '<w:cols w:space="425"/><w:docGrid w:type="none" w:linePitch="312"/></w:sectPr>';

    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<w:body>' + body.join('') + sectPr + '</w:body></w:document>';

    var fonts = fontsFor('sans');
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>';

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';

    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      (photo ? '<Relationship Id="rIdPhoto" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + photo.ext + '"/>' : '') +
      '</Relationships>';

    var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="' + fonts.ascii + '" w:hAnsi="' + fonts.ascii + '" w:eastAsia="' + fonts.ea + '" w:cs="' + fonts.ascii + '"/>' +
      '<w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '</w:styles>';

    var enc = new TextEncoder();
    var files = [
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(rels) },
      { name: 'word/document.xml', data: enc.encode(documentXml) },
      { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
      { name: 'word/styles.xml', data: enc.encode(stylesXml) }
    ];
    if (photo) files.push({ name: 'word/media/photo.' + photo.ext, data: photo.bytes });
    return window.MiniZip.zipStore(files);
  }

  function build(spec) {
    var m = spec.margin;
    var fonts = fontsFor(spec.fam);
    var contentW = tw(spec.contentW);
    var body = [];

    // 原文件里的证件照：按原 PDF 的位置与尺寸浮动贴回
    var photo = null;
    if (spec.photo && spec.photo.data && spec.photo.w > 0 && spec.photo.h > 0) {
      photo = photoFile(spec.photo.data);
    }
    var photoName = photo ? ('photo.' + photo.ext) : '';
    var photoRun = photo ? photoAnchor('rIdPhoto', photoName, spec.photo) : '';

    spec.lines.forEach(function (l) {
      var pPr = '<w:pPr>';
      if (l.rule) {
        pPr += '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="101214"/></w:pBdr>';
      }
      pPr += '<w:spacing w:before="' + tw((l.gapBefore || 0) + (l.padTop || 0)) + '" w:after="0" w:line="' + tw(l.lineH) + '" w:lineRule="exact"/>';
      if (l.right) pPr += '<w:tabs><w:tab w:val="right" w:pos="' + contentW + '"/></w:tabs>';
      if (l.hang) {
        var hang = Math.round((l.size || 9.5) * 1.5 * 20);
        if (l.bullet) pPr += '<w:ind w:left="' + (tw(l.indent) + hang) + '" w:hanging="' + hang + '"/>';
        else pPr += '<w:ind w:left="' + tw(l.indent) + '"/>';
      } else if (l.indent) {
        pPr += '<w:ind w:left="' + tw(l.indent) + '"/>';
      }
      pPr += '<w:jc w:val="left"/><w:snapToGrid w:val="0"/></w:pPr>';

      var runs = '';
      if (l.bullet) runs += run((l.bulletChar || '•') + '\u00a0', { fonts: fonts, size: l.size, color: '101214' });
      runs += run(l.text || ' ', { fonts: fonts, size: l.size, b: l.bold });
      if (l.right) {
        runs += run('', { fonts: fonts, size: l.rightSize || l.size, tab: true });
        runs += run(l.right, { fonts: fonts, size: l.rightSize || l.size, color: '3A3F46' });
      }
      body.push('<w:p>' + pPr + runs + '</w:p>');
    });

    // 照片锚点挂在正文第一个段落里，避免额外占一行高度
    if (photoRun && body.length) {
      var first = body[0];
      var at = first.indexOf('</w:pPr>');
      if (at >= 0) body[0] = first.slice(0, at + 8) + photoRun + first.slice(at + 8);
      else body[0] = first.replace('<w:p>', '<w:p>' + photoRun);
    }

    var sectPr = '<w:sectPr><w:pgSz w:w="' + A4W + '" w:h="' + A4H + '"/>' +
      '<w:pgMar w:top="' + tw(m.t) + '" w:right="' + tw(m.r) + '" w:bottom="' + tw(m.b) +
      '" w:left="' + tw(m.l) + '" w:header="720" w:footer="720" w:gutter="0"/>' +
      '<w:cols w:space="425"/><w:docGrid w:type="none" w:linePitch="312"/></w:sectPr>';

    var documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<w:body>' + body.join('') + sectPr + '</w:body></w:document>';

    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      '<Default Extension="jpg" ContentType="image/jpeg"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>';

    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';

    var docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      (photo ? '<Relationship Id="rIdPhoto" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + photoName + '"/>' : '') +
      '</Relationships>';

    var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' +
      '<w:rFonts w:ascii="' + fonts.ascii + '" w:hAnsi="' + fonts.ascii + '" w:eastAsia="' + fonts.ea + '" w:cs="' + fonts.ascii + '"/>' +
      '<w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '</w:styles>';

    var enc = new TextEncoder();
    var files = [
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(rels) },
      { name: 'word/document.xml', data: enc.encode(documentXml) },
      { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
      { name: 'word/styles.xml', data: enc.encode(stylesXml) }
    ];
    if (photo) files.push({ name: 'word/media/' + photoName, data: photo.bytes });
    return window.MiniZip.zipStore(files);
  }

  root.ResumeDocxLayout = { build: build, buildPaint: buildPaint };
})(typeof window !== 'undefined' ? window : this);

/* docx.js — 直接生成 OOXML 的 .docx（不依赖任何第三方库） */
(function () {
  'use strict';

  var CONTENT_W = 9638;      // A4 减去左右各 2cm 后的正文宽度（twips）
  var INK = '15171A';
  var GRAY = '4E545C';
  var LIGHT = '8A8A80';

  var PRESET = {
    swiss:    { jc: 'left',   nameSz: 42, nameEA: '微软雅黑', nameSp: 20, headSz: 21, headSp: 30, ruleColor: INK,   headBorder: '6' },
    classic:  { jc: 'center', nameSz: 36, nameEA: '微软雅黑', nameSp: 60, headSz: 21, headSp: 50, ruleColor: INK,   headBorder: '6' },
    academic: { jc: 'left',   nameSz: 38, nameEA: '宋体',     nameSp: 40, headSz: 21, headSp: 40, ruleColor: 'D8D8D0', headBorder: '4' }
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function run(text, o) {
    o = o || {};
    var ea = o.ea || '宋体';
    var ascii = o.ascii || 'Times New Roman';
    var rPr = '<w:rPr><w:rFonts w:ascii="' + ascii + '" w:hAnsi="' + ascii + '" w:eastAsia="' + ea + '" w:cs="' + ascii + '"/>';
    if (o.b) rPr += '<w:b/><w:bCs/>';
    rPr += '<w:color w:val="' + (o.color || INK) + '"/>';
    if (o.sp) rPr += '<w:spacing w:val="' + o.sp + '"/>';
    var sz = Math.max(16, Math.round((o.sz || 21) * SIZE));
    rPr += '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>';
    var body = o.tab ? '<w:tab/>' : '<w:t xml:space="preserve">' + esc(text) + '</w:t>';
    return '<w:r>' + rPr + body + '</w:r>';
  }

  function para(runs, o) {
    o = o || {};
    var pPr = '<w:pPr>';
    if (o.border) {
      pPr += '<w:pBdr><w:bottom w:val="single" w:sz="' + o.borderSz + '" w:space="2" w:color="' + o.border + '"/></w:pBdr>';
    }
    if (o.tabs) pPr += '<w:tabs><w:tab w:val="right" w:pos="' + CONTENT_W + '"/></w:tabs>';
    var before = Math.round((o.before || 0) * SPACE);
    var after = Math.round((o.after || 0) * SPACE);
    var line = Math.round((o.line || 280) * LINE);
    pPr += '<w:spacing w:before="' + before + '" w:after="' + after + '" w:line="' + line + '" w:lineRule="auto"/>';
    if (o.ind) pPr += '<w:ind w:left="' + o.ind + '" w:hanging="' + (o.hang || 0) + '"/>';
    pPr += '<w:jc w:val="' + (o.jc || 'both') + '"/>';
    pPr += '</w:pPr>';
    return '<w:p>' + pPr + (runs || '') + '</w:p>';
  }

  /* ---------------- 照片 ---------------- */

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

  var PHOTO_W = 900000;   // 25mm
  var PHOTO_H = 1260000;  // 35mm

  function drawing(rid, name) {
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + PHOTO_W + '" cy="' + PHOTO_H + '"/>' +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      '<wp:docPr id="101" name="' + name + '" descr="证件照"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="101" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + PHOTO_W + '" cy="' + PHOTO_H + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  }

  /** 抬头区：左侧信息 / 右侧照片，无边框两栏表 */
  function headTable(leftXml, photoName) {
    var rightW = 2000;
    var leftW = CONTENT_W - rightW;
    var noBorder = '<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>' +
      '<w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders>';
    return '<w:tbl><w:tblPr><w:tblW w:w="' + CONTENT_W + '" w:type="dxa"/>' +
      noBorder + '<w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
      '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr>' +
      '<w:tblGrid><w:gridCol w:w="' + leftW + '"/><w:gridCol w:w="' + rightW + '"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr><w:tcW w:w="' + leftW + '" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>' +
      leftXml + '</w:tc>' +
      '<w:tc><w:tcPr><w:tcW w:w="' + rightW + '" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>' +
      para(drawing('rIdPhoto', photoName), { jc: 'right', after: 0, line: 240 }) +
      '</w:tc></w:tr></w:tbl>';
  }

  var EN = {
    summary: 'PROFILE', education: 'EDUCATION', experience: 'EXPERIENCE',
    project: 'PROJECTS', campus: 'CAMPUS', skills: 'SKILLS', awards: 'HONORS',
    language: 'LANGUAGES', other: 'ADDITIONAL'
  };

  // 一页压缩档位：0 原样，1~3 逐级收紧段前段后与行距，4~5 再轻微缩字号
  var FIT = [
    { s: 1.00, l: 1.00, z: 1.00 },
    { s: 0.80, l: 0.97, z: 1.00 },
    { s: 0.62, l: 0.94, z: 1.00 },
    { s: 0.48, l: 0.91, z: 1.00 },
    { s: 0.40, l: 0.88, z: 0.96 },
    { s: 0.34, l: 0.85, z: 0.92 }
  ];
  var SPACE = 1, LINE = 1, SIZE = 1;

  function build(model, opts) {
    opts = opts || {};
    var fit = FIT[opts.fit || 0] || FIT[0];
    SPACE = fit.s;
    LINE = fit.l;
    SIZE = fit.z;
    var p = PRESET[opts.style] || PRESET.swiss;
    var body = [];

    var photo = (opts.photo !== undefined ? opts.photo : !!model.photo) ? photoFile(model.photo) : null;
    var photoName = photo ? ('photo.' + photo.ext) : '';

    // 姓名 / 意向 / 联系方式：有照片时放进两栏表，右侧留照片
    var headXml = [];
    headXml.push(para(run(model.name || '姓名', {
      sz: p.nameSz, ea: p.nameEA, b: true, color: INK, sp: p.nameSp
    }), { jc: p.jc, after: 60, line: 240 }));

    if (model.intent) {
      headXml.push(para(run('求职意向：' + model.intent, { sz: 19, color: GRAY, sp: 10 }), { jc: p.jc, after: 60, line: 240 }));
    }

    if (model.contact.length) {
      var line = model.contact.filter(function (c) { return c.label !== '链接'; }).map(function (c) {
        return c.label + ' ' + c.value;
      }).join('　｜　');
      headXml.push(para(run(line, { sz: 18, color: GRAY }), { jc: p.jc, after: 60, line: 240 }));
    }

    if (photo) body.push(headTable(headXml.join(''), photoName));
    else body = body.concat(headXml);

    // 分隔线
    body.push(para(run(' ', { sz: 2 }), {
      jc: 'left', before: 60, after: 0, line: 240, border: p.ruleColor, borderSz: 8
    }));

    model.sections.forEach(function (s) {
      var hasContent = s.text || s.chips.length || s.items.length;
      if (!hasContent) return;

      var headRuns = run(s.heading, { sz: p.headSz, ea: '微软雅黑', b: true, sp: p.headSp });
      if (p.jc === 'center') headRuns = run('　' + s.heading + '　', { sz: p.headSz, ea: '微软雅黑', b: true, sp: p.headSp });

      body.push(para(headRuns, {
        jc: p.jc === 'center' ? 'center' : 'left',
        before: 240, after: 80, line: 240, border: p.ruleColor, borderSz: p.headBorder
      }));

      if (s.mode === 'para') {
        body.push(para(run(s.text || '', { sz: 20, color: INK }), { jc: 'both', before: 40, after: 40, line: 320 }));
      } else if (s.mode === 'chips') {
        s.chips.forEach(function (c) {
          body.push(para(run('•　' + c, { sz: 20, color: INK }), {
            jc: 'left', after: 20, line: 300, ind: 283, hang: 283
          }));
        });
      } else {
        s.items.forEach(function (it) {
          var left = '';
          left += run(it.org || '', { sz: 21, ea: '微软雅黑', b: true });
          var tail = [];
          if (it.role) tail.push(it.role);
          if (it.major) tail.push(it.major);
          if (it.degree) tail.push(it.degree);
          if (it.place) tail.push(it.place);
          if (tail.length) left += run('　' + tail.join(' · '), { sz: 19, color: GRAY });

          if (it.meta) {
            left += run('', { tab: true, sz: 18 });
            left += run(it.meta, { sz: 17, color: GRAY, ascii: 'Consolas' });
          }
          body.push(para(left, { jc: 'left', before: 100, after: 40, line: 260, tabs: !!it.meta }));

          it.bullets.forEach(function (b) {
            body.push(para(run('•　' + b, { sz: 20, color: INK }), {
              jc: 'both', after: 20, line: 300, ind: 283, hang: 283
            }));
          });
        });
      }
    });

    var sectPr = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1020" w:right="1134" w:bottom="1020" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/>' +
      '<w:cols w:space="425"/><w:docGrid w:linePitch="312"/></w:sectPr>';

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
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体" w:cs="Times New Roman"/>' +
      '<w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:line="280" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
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

  window.ResumeDocx = { build: build };
})();

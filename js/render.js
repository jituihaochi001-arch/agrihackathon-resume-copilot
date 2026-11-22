/* render.js — A4 成稿渲染与纯文本导出 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var EN = {
    summary: 'PROFILE', education: 'EDUCATION', experience: 'EXPERIENCE',
    project: 'PROJECTS', campus: 'CAMPUS', skills: 'SKILLS', awards: 'HONORS',
    language: 'LANGUAGES', other: 'ADDITIONAL'
  };

  var ORDER = ['summary', 'experience', 'project', 'campus', 'education', 'skills', 'awards', 'language', 'other'];

  function contactLine(model) {
    return model.contact.filter(function (c) { return c.label !== '链接'; }).map(function (c) {
      return '<span><i>' + esc(c.label) + '</i>' + esc(c.value) + '</span>';
    }).join('');
  }

  function renderPaper(container, model, opts) {
    opts = opts || {};
    var style = opts.style || 'swiss';
    var photo = opts.photo !== undefined ? !!opts.photo : !!model.photo;

    var h = [];
    // 两栏模板左侧的深色色带：用真实元素而不是 ::before，
    // 否则导出 PDF / PNG 时抓不到伪元素，色带会整块消失。
    h.push('<div class="r-band" aria-hidden="true"></div>');
    h.push('<div class="r-head">');
    h.push('<div class="r-head-main">');
    h.push('<h1 class="r-name">' + (esc(model.name) || '你的姓名') + '</h1>');
    if (model.intent) h.push('<p class="r-intent">求职意向：' + esc(model.intent) + '</p>');
    var cl = contactLine(model);
    if (cl) h.push('<div class="r-contact">' + cl + '</div>');
    h.push('</div>');
    if (photo) {
      if (model.photo) h.push('<div class="r-photo has-img" title="点击更换证件照"><img src="' + model.photo + '" alt="证件照" /></div>');
      else if (opts.slot !== false) h.push('<div class="r-photo is-slot" title="点击上传证件照">＋<br/>证件照</div>');
    }
    h.push('</div>');
    h.push('<div class="r-rule"></div>');

    model.sections.forEach(function (s) {
      var hasContent = s.text || s.chips.length || s.items.length;
      if (!hasContent) {
        if (!opts.showEmpty) return;
        // 编辑器的实时预览：新建的空模块也要显示出来，否则看起来像「没加上」
        h.push('<section class="r-sec is-empty">');
        h.push('<div class="r-sec-h"><h3>' + esc(s.heading) + '</h3><span class="en">' + esc(EN[s.type] || s.en || '') + '</span></div>');
        h.push('<p class="r-empty">还没有填写内容，导出时会自动省略这个空模块。</p>');
        h.push('</section>');
        return;
      }

      h.push('<section class="r-sec">');
      // r-bar 只有瑞士模板用（左侧强调竖条），用真实元素而不是 ::before，
      // 否则导出 PDF / PNG 时抓不到伪元素。
      h.push('<div class="r-sec-h"><i class="r-bar" aria-hidden="true"></i><h3>' + esc(s.heading) + '</h3><span class="en">' + esc(EN[s.type] || s.en || '') + '</span></div>');

      if (s.mode === 'para') {
        h.push('<p class="r-para">' + esc(s.text || '') + '</p>');
      } else if (s.mode === 'chips') {
        h.push('<div class="r-chips">' + s.chips.map(function (c) { return '<span><i class="r-dot"></i>' + esc(c) + '</span>'; }).join('') + '</div>');
      } else {
        s.items.forEach(function (it) {
          h.push('<div class="r-item">');
          h.push('<div class="r-item-h"><div class="r-item-l">');
          if (it.org) h.push('<span class="r-org">' + esc(it.org) + '</span>');
          if (it.role) h.push('<span class="r-role"><i class="r-sep">／</i>' + esc(it.role) + '</span>');
          if (it.major) h.push('<span class="r-role"><i class="r-sep">／</i>' + esc(it.major) + '</span>');
          if (it.degree) h.push('<span class="r-role"><i class="r-sep">／</i>' + esc(it.degree) + '</span>');
          if (it.place) h.push('<span class="r-role"><i class="r-sep">／</i>' + esc(it.place) + '</span>');
          h.push('</div>');
          if (it.meta) h.push('<span class="r-meta">' + esc(it.meta) + '</span>');
          h.push('</div>');
          if (it.bullets.length) {
            h.push('<ul class="r-bullets">' + it.bullets.map(function (b) { return '<li><i class="r-dot"></i>' + esc(b) + '</li>'; }).join('') + '</ul>');
          }
          h.push('</div>');
        });
      }
      h.push('</section>');
    });

    container.className = 'paper style-' + style;
    container.removeAttribute('style');     // 清掉原版式模式留下的行内 padding
    container.innerHTML = h.join('');
    // 模板中心：把颜色 / 间距 / 标题形态写成 CSS 变量（无模板时用当前生效的那套）
    if (window.Templates) window.Templates.apply(container, opts.template);
  }

  /* ---------------- 原版式（PDF 重建）渲染 ---------------- */

  /** 粗略估算右侧文字宽度：中文按 1em，西文按 0.58em */
  function estWidth(s, size) {
    var w = 0;
    for (var i = 0; i < String(s).length; i++) {
      var c = s.charCodeAt(i);
      w += (c > 0x2e80 && c < 0xa4d0) ? 1 : 0.58;
    }
    return w * size;
  }

  /** 按原文档的换行点还原多行段落；文字被改写后（无 breaks）交给浏览器自然回流 */
  function withBreaks(text, breaks) {
    var s = String(text == null ? '' : text);
    if (!breaks || !breaks.length) return esc(s);
    var out = '', pos = 0;
    breaks.forEach(function (b) {
      if (b <= pos || b > s.length) return;
      out += esc(s.slice(pos, b)) + '<br>';
      pos = b;
    });
    out += esc(s.slice(pos));
    return out;
  }

  function renderFlow(container, spec) {
    var m = spec.margin;
    var fam = spec.fam === 'serif'
      ? '"Songti SC","Noto Serif SC","Source Han Serif SC","SimSun",Georgia,serif'
      : '"PingFang SC","Microsoft YaHei","Noto Sans SC","Inter",sans-serif';
    var h = [];

    spec.lines.forEach(function (l) {
      var st = 'margin-top:' + ((l.gapBefore || 0) + (l.padTop || 0)) + 'pt;line-height:' + l.lineH + 'pt;' +
        'font-size:' + l.size + 'pt;font-family:' + fam + ';';
      if (l.hang) {
        var hang = l.size * 1.5;
        if (l.bullet) {
          // 本行自带项目符号：符号挂在缩进位，文字缩进一格（悬挂缩进）
          st += 'padding-left:' + (l.indent + hang) + 'pt;text-indent:' + (-hang) + 'pt;';
        } else {
          // 续行：符号在上一行已经画过，这里直接落在原文档的 x 上
          st += 'padding-left:' + l.indent + 'pt;';
        }
      } else if (l.indent) {
        st += 'padding-left:' + l.indent + 'pt;';
      }
      var cls = 'ly' + (l.rule ? ' rule' : '');
      if (l.bold) st += 'font-weight:700;';

      var inner = (l.bullet ? '<span class="ly-b">' + esc(l.bulletChar || '•') + '</span>' : '') + withBreaks(l.text || '', l.breaks);
      if (l.right) {
        var rw = estWidth(l.right, l.rightSize || l.size) + 6;
        st += 'padding-right:' + rw + 'pt;';
        inner += '<span class="ly-r" style="font-size:' + (l.rightSize || l.size) + 'pt">' + esc(l.right) + '</span>';
      }
      // 分隔线：按原 PDF 里的真实宽度画（常常比整行窄，比如只画到照片右缘）
      if (l.rule) {
        var rLeft = l.ruleX != null ? l.ruleX : 0;
        var rW = l.ruleW != null ? l.ruleW : (spec.contentW - rLeft);
        inner += '<i class="ly-rule" style="left:' + rLeft + 'pt;width:' + rW + 'pt"></i>';
      }
      h.push('<div class="' + cls + '" style="' + st + '">' + inner + '</div>');
    });

    container.className = 'paper lay';
    container.setAttribute('style', 'padding:' + m.t + 'pt ' + m.r + 'pt ' + m.b + 'pt ' + m.l + 'pt;');
    container.innerHTML = h.join('');

    // 原文件里的证件照：按它在 PDF 中的真实位置与尺寸贴回去
    if (spec.photo && spec.photo.data) {
      var ph = spec.photo;
      var img = document.createElement('img');
      img.className = 'ly-photo';
      img.src = ph.data;
      img.alt = '';
      img.setAttribute('style',
        'position:absolute;left:' + ph.x + 'pt;top:' + ph.yTop + 'pt;' +
        'width:' + ph.w + 'pt;height:' + ph.h + 'pt;');
      container.appendChild(img);
    }
  }

  /* ---------------- 原版式（绘制原语照搬）渲染 ---------------- */

  var A4_W = 595.276, A4_H = 841.89;

  /* 字体度量缓存：用来把「基线」换算成「盒子的 top」 */
  var metricCache = {}, mctx = null;

  /**
   * 取某个 CSS 字体的 ascent / descent 比例。
   * 必须用 canvas 量 —— 导出 PDF 时（pdfwrite.metricsOf）用的是同一套度量，
   * 这样预览里的基线位置和导出的 PDF 才会完全一致。
   */
  function fontMetrics(family, weight, style) {
    var key = family + '|' + weight + '|' + style;
    if (metricCache[key]) return metricCache[key];
    var m = { ascent: 0.88, descent: 0.22 };
    try {
      if (!mctx) mctx = document.createElement('canvas').getContext('2d');
      mctx.font = (style || 'normal') + ' ' + (weight || 400) + ' 100px ' + family;
      var tm = mctx.measureText('汉Ag');
      if (tm.fontBoundingBoxAscent && tm.fontBoundingBoxDescent) {
        m = { ascent: tm.fontBoundingBoxAscent / 100, descent: tm.fontBoundingBoxDescent / 100 };
      }
    } catch (e) { /* 用兜底值 */ }
    metricCache[key] = m;
    return m;
  }

  /** 基线 → 盒子的 top（px→pt 已在 CSS 里处理，这里返回 pt） */
  function topOfBaseline(baselinePt, lineHPt, sizePt, met) {
    return baselinePt - (lineHPt / 2 + (met.ascent - met.descent) * sizePt / 2);
  }

  /**
   * 按 PDF 的绘制原语原样还原一页。
   * 色块 / 线条 / 文字段 / 图片全部按原始坐标绝对定位，
   * 灰底通栏、标题左侧黑竖条、中英文双色双字号、三列并排、照片原位全部保留。
   */
  function renderPaint(container, spec) {
    var pages = (spec && spec.pages) || [];
    var h = [];
    var totalPt = 0;
    var pagesHtml = [];

    pages.forEach(function (pg, pi) {
      var k = Math.min(A4_W / pg.width, A4_H / pg.height);
      var ox = (A4_W - pg.width * k) / 2;
      var oy = totalPt;
      totalPt += pg.height * k;
      var P = [];

      // 色块（灰底通栏、标题左侧黑色竖条……）
      (pg.rects || []).forEach(function (r) {
        P.push('<i class="pt-rect" style="left:' + (ox + r.x * k).toFixed(2) + 'pt;top:' +
          (oy + r.y * k).toFixed(2) + 'pt;width:' + (r.w * k).toFixed(2) + 'pt;height:' +
          (r.h * k).toFixed(2) + 'pt;background:' + r.fill + '"></i>');
      });

      // 描边（分隔线）
      (pg.lines || []).forEach(function (l) {
        var x = Math.min(l.x1, l.x2), y = Math.min(l.y1, l.y2);
        var w = Math.abs(l.x2 - l.x1), hh = Math.abs(l.y2 - l.y1);
        var lw = Math.max(0.3, (l.w || 0.7) * k);
        if (hh > lw) { x = Math.min(l.x1, l.x2); y = Math.min(l.y1, l.y2); w = lw; hh = Math.abs(l.y2 - l.y1); }
        else { y = y - lw / 2; hh = lw; }
        P.push('<i class="pt-line" style="left:' + (ox + x * k).toFixed(2) + 'pt;top:' +
          (oy + y * k).toFixed(2) + 'pt;width:' + Math.max(0.4, w * k).toFixed(2) + 'pt;height:' +
          hh.toFixed(2) + 'pt;background:' + l.color + '"></i>');
      });

      // 图片（证件照）
      (pg.images || []).forEach(function (im) {
        if (!im.data) return;
        P.push('<img class="pt-img" alt="" src="' + im.data + '" style="left:' +
          (ox + im.x * k).toFixed(2) + 'pt;top:' + (oy + im.yTop * k).toFixed(2) + 'pt;width:' +
          (im.w * k).toFixed(2) + 'pt;height:' + (im.h * k).toFixed(2) + 'pt;">');
      });

      // 文字段
      (pg.runs || []).forEach(function (r) {
        if (!r.text) return;
        var css = window.ResumePaint.fontCss(r.base);
        var size = r.size * k;
        var lineH = r.wrapW ? (r.lineH * k) : size;
        var met = fontMetrics(css.family, css.weight, css.style);
        var top = topOfBaseline(r.y * k, lineH, size, met);
        var st = 'left:' + (ox + r.x * k).toFixed(2) + 'pt;top:' + top.toFixed(2) + 'pt;' +
          'font-size:' + size.toFixed(2) + 'pt;line-height:' + lineH.toFixed(2) + 'pt;' +
          'font-family:' + css.family + ';font-weight:' + css.weight + ';color:' + r.color + ';';
        if (r.wrapW) {
          st += 'width:' + (r.wrapW * k).toFixed(2) + 'pt;white-space:pre-wrap;word-break:break-word;';
        } else {
          st += 'white-space:pre;';
        }
        P.push('<i class="pt-t' + (r.replaced ? ' is-new' : '') + '" style="' + st + '">' + esc(r.text) + '</i>');
      });

      pagesHtml.push('<div class="pt-page" style="left:' + ox.toFixed(2) + 'pt;top:' + oy.toFixed(2) +
        'pt;width:' + (pg.width * k).toFixed(2) + 'pt;height:' + (pg.height * k).toFixed(2) + 'pt;">' +
        P.join('') + '</div>');
    });

    container.className = 'paper paint';
    container.setAttribute('style', 'padding:0;min-height:' + Math.max(1123, totalPt * 4 / 3).toFixed(1) + 'px;');
    container.innerHTML = pagesHtml.join('');
  }

  function fit(paperScale, paper, shell) {    if (!shell || !paperScale) return 1;    var avail = shell.clientWidth - 44;
    var w = paper.offsetWidth || 794;
    var scale = Math.min(1, avail / w);
    paperScale.style.transform = 'scale(' + scale + ')';
    paperScale.style.height = (paper.offsetHeight * scale) + 'px';
    paperScale.style.width = w + 'px';
    return scale;
  }

  /* ---------------- 纯文本导出 ---------------- */

  function toMarkdown(model) {
    var out = ['# ' + (model.name || '姓名')];
    if (model.intent) out.push('**求职意向：' + model.intent + '**');
    if (model.contact.length) out.push(model.contact.map(function (c) { return c.label + '：' + c.value; }).join(' ｜ '));
    out.push('');
    model.sections.forEach(function (s) {
      out.push('## ' + s.heading);
      if (s.mode === 'para') out.push(s.text || '');
      else if (s.mode === 'chips') out.push(s.chips.map(function (c) { return '- ' + c; }).join('\n'));
      else s.items.forEach(function (it) {
        var head = [it.org, it.role, it.degree, it.major, it.place].filter(Boolean).join(' · ');
        out.push('### ' + head + (it.meta ? '　　' + it.meta : ''));
        it.bullets.forEach(function (b) { out.push('- ' + b); });
        out.push('');
      });
      out.push('');
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function toPlain(model) {
    var out = [model.name || '姓名'];
    if (model.intent) out.push('求职意向：' + model.intent);
    if (model.contact.length) out.push(model.contact.map(function (c) { return c.label + '：' + c.value; }).join(' | '));
    out.push('');
    model.sections.forEach(function (s) {
      out.push('【' + s.heading + '】');
      if (s.mode === 'para') out.push(s.text || '');
      else if (s.mode === 'chips') out.push(s.chips.join(' / '));
      else s.items.forEach(function (it) {
        var head = [it.org, it.role, it.degree, it.major, it.place].filter(Boolean).join('  ');
        out.push(head + (it.meta ? '\t' + it.meta : ''));
        it.bullets.forEach(function (b) { out.push('· ' + b); });
      });
      out.push('');
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function toHtmlDoc(model, style, photo) {
    var tmp = document.createElement('div');
    renderPaper(tmp, model, { style: style, photo: photo, slot: false });
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>' + esc(model.name || '简历') + ' · 简历</title>' +
      '<style>@page{size:A4;margin:0}body{margin:0;background:#F4F5F7;display:flex;justify-content:center}' +
      '.paper{width:210mm;min-height:297mm;background:#fff;padding:16mm 17mm;box-sizing:border-box}</style>' +
      '</head><body>' + tmp.innerHTML + '</body></html>';
  }

  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  window.ResumeRender = {
    render: renderPaper,
    renderFlow: renderFlow,
    renderPaint: renderPaint,
    fontMetrics: fontMetrics,
    fit: fit,
    toMarkdown: toMarkdown,
    toPlain: toPlain,
    toHtmlDoc: toHtmlDoc,
    download: download,
    esc: esc,
    ORDER: ORDER
  };
})();

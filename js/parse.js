/* parse.js — 文件 → 纯文本（docx 原生解析 / pdf 走 pdf.js / txt 直读） */
(function () {
  'use strict';

  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var PDFJS_SOURCES = [
    { lib: 'vendor/pdf.min.js', worker: 'vendor/pdf.worker.min.js' },
    { lib: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js', worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js' },
    { lib: 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js', worker: 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js' }
  ];

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + src + '"]')) return resolve();
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('资源加载失败')); };
      document.head.appendChild(s);
    });
  }

  /** 从 document.xml / header*.xml 的 DOM 中按顺序抽段落文字 */
  function parasToLines(body) {
    var paras = body.getElementsByTagNameNS(W, 'p');
    var lines = [];
    for (var i = 0; i < paras.length; i++) {
      var nodes = paras[i].getElementsByTagName('*');
      var buf = '';
      for (var j = 0; j < nodes.length; j++) {
        var nd = nodes[j];
        if (nd.namespaceURI !== W) continue;
        var local = nd.localName;
        if (local === 't') buf += nd.textContent;
        else if (local === 'tab') buf += '  ';
        else if (local === 'br' || local === 'cr') buf += '\n';
      }
      lines.push(buf);
    }
    return lines;
  }

  var MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp' };

  function bytesToBase64(u8) {
    var out = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < u8.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
    }
    return btoa(out);
  }

  function measure(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = function () { resolve(null); };
      img.src = dataUrl;
    });
  }

  /**
   * 从 word/media 里挑最像证件照的一张：
   * 竖版、尺寸够大、面积优先。找不到就不返回，避免拿装饰图当头像。
   */
  function pickPhoto(files) {
    var cands = [];
    files.forEach(function (data, name) {
      var m = name.match(/^word\/media\/[^\/]+\.([a-z]+)$/i);
      if (!m) return;
      var ext = m[1].toLowerCase();
      if (!MIME[ext]) return;
      if (data.length < 800) return;           // 图标、装饰线通常更小
      if (data.length > 6 * 1024 * 1024) return;
      cands.push({ name: name, data: data, ext: ext });
    });
    if (!cands.length) return Promise.resolve('');

    cands.sort(function (a, b) { return b.data.length - a.data.length; });
    cands = cands.slice(0, 8);

    return Promise.all(cands.map(function (c) {
      var url = 'data:' + MIME[c.ext] + ';base64,' + bytesToBase64(c.data);
      return measure(url).then(function (dim) {
        return { url: url, dim: dim, size: c.data.length };
      });
    })).then(function (list) {
      var best = null, bestScore = -1;
      list.forEach(function (it) {
        if (!it.dim || !it.dim.w || !it.dim.h) return;
        var ratio = it.dim.h / it.dim.w;
        if (it.dim.w < 90 || it.dim.h < 90) return;
        if (ratio < 0.62 || ratio > 1.75) return;  // 只要竖版或近方
        var score = it.dim.w * it.dim.h * (ratio > 1 ? 1.25 : 1);
        if (score > bestScore) { bestScore = score; best = it; }
      });
      return best ? best.url : '';
    });
  }

  function docxRead(buf) {
    return MiniZip.unzip(buf).then(function (files) {
      var docFile = files.get('word/document.xml');
      if (!docFile) throw new Error('文件中未找到正文，可能不是 .docx 格式');
      var dec = new TextDecoder('utf-8');
      var dom = new DOMParser().parseFromString(dec.decode(docFile), 'application/xml');
      if (dom.getElementsByTagName('parsererror').length) throw new Error('文档结构解析失败');

      var body = dom.getElementsByTagNameNS(W, 'body')[0] || dom.documentElement;
      var lines = parasToLines(body);

      // 页眉常放姓名/电话/城市/照片，必须一起读，否则会误判「没写城市」
      var headers = [];
      files.forEach(function (data, name) {
        if (!/^word\/header\d*\.xml$/.test(name)) return;
        var hd = new DOMParser().parseFromString(dec.decode(data), 'application/xml');
        if (hd.getElementsByTagName('parsererror').length) return;
        parasToLines(hd.documentElement).forEach(function (l) {
          if (l.trim()) headers.push(l);
        });
      });

      return pickPhoto(files).then(function (photo) {
        return {
          text: headers.concat(lines).join('\n'),
          photo: photo || '',
          files: files,
          docXml: dec.decode(docFile)
        };
      });
    });
  }

  function docxToText(buf) { return docxRead(buf).then(function (r) { return r.text; }); }

  async function ensurePdfLib() {
    if (window.pdfjsLib) return PDFJS_SOURCES[0];
    for (var i = 0; i < PDFJS_SOURCES.length; i++) {
      try {
        await loadScript(PDFJS_SOURCES[i].lib);
      } catch (e) { /* 换下一个源 */ }
      if (window.pdfjsLib) return PDFJS_SOURCES[i];
    }
    throw new Error('PDF 解析组件加载失败（可能是网络限制），请改用 DOCX 或直接粘贴文本');
  }

  function famOf(style) {
    var ff = (style && style.fontFamily) || '';
    if (/song|sun|serif|ming|kai|times|georgia/i.test(ff) && !/sans-serif/i.test(ff)) return 'serif';
    return 'sans';
  }

  function pageItems(page, tc) {
    var out = [];
    tc.items.forEach(function (it) {
      var s = it.str == null ? '' : it.str;
      var size = Math.sqrt(it.transform[2] * it.transform[2] + it.transform[3] * it.transform[3]) || it.height;
      var st = tc.styles[it.fontName] || {};
      if (!s.trim()) {
        // 纯空白占位项：pdf.js 用「空字符串 + 宽度」表示空格。
        // 必须保留 —— 否则原文里的空格会凭空消失（"Spark SQL" 变成 "SparkSQL"）。
        if (it.width > 0.05) {
          out.push({
            str: '', x: it.transform[4], y: it.transform[5], w: it.width,
            size: size, font: it.fontName, fam: famOf(st)
          });
        }
        return;
      }
      out.push({
        str: s,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width,
        size: size,
        font: it.fontName,
        fam: famOf(st)
      });
    });
    return out;
  }

  /**
   * 解析 PDF 里用到的字体 → BaseFont 名（如 "TXYDTX+Microsoft YaHei Bold"）。
   * 有了它才能还原「标题是粗体 / 副标题是蓝色 / 正文是常规字重」这些原版细节。
   * 注意：必须先跑一次 getTextContent()，字体对象才会被 pdf.js 解析出来。
   */
  function resolveFonts(page, opsList, OPS) {
    var map = {};
    var names = [];
    for (var i = 0; i < opsList.fnArray.length; i++) {
      if (opsList.fnArray[i] === OPS.setFont) {
        var n = opsList.argsArray[i] && opsList.argsArray[i][0];
        if (n && map[n] === undefined) { map[n] = null; names.push(n); }
      }
    }
    var done = Promise.resolve();
    names.forEach(function (n) {
      done = done.then(function () {
        try {
          if (!page.commonObjs || !page.commonObjs.has(n)) { map[n] = ''; return; }
          var f = page.commonObjs.get(n);
          if (f && typeof f.then === 'function') {
            return f.then(function (ff) {
              map[n] = (ff && (ff.name || ff.loadedName)) || '';
            }).catch(function () { map[n] = ''; });
          }
          map[n] = (f && (f.name || f.loadedName)) || '';
        } catch (e) {
          map[n] = '';
        }
      }).catch(function () { map[n] = ''; });
    });
    // 字体名只关系到「粗体 / 字体族」的还原，取不到也必须让绘制原语照常输出 ——
    // 一旦这里 reject，整页的色块、坐标、颜色会跟着一起丢掉。
    return done.then(function () { return map; }).catch(function () { return map; });
  }

  /**
   * 页 → { layout, rows, paint }
   * 每一页都做完整的版式分析（页边距 / 字号 / 行坐标 / 分隔线 / 图片），
   * 同时把「绘制原语」（色块 / 描边 / 带颜色与字号的文字段）整条取出来 ——
   * 「保留原版式」靠的是这些原语，而不是重新猜参数。
   */
  function readPage(page, lib) {
    var vp = page.getViewport({ scale: 1 });
    return page.getTextContent().then(function (tc) {
      var items = pageItems(page, tc);
      var base = { width: vp.width, height: vp.height, items: items };
      var opsP = page.getOperatorList().then(function (opsList) {
        var rules = [], images = [];
        try { rules = window.ResumePdfLayout.collectRules(opsList, lib.OPS); } catch (e) { rules = []; }
        try {
          images = window.ResumePdfLayout.collectImages(opsList, lib.OPS, page.objs, vp.height);
        } catch (e) { images = []; }

        var paint = null;
        return resolveFonts(page, opsList, lib.OPS).then(function (fonts) {
          try {
            var raw = window.ResumePaint.collect(opsList, lib.OPS, vp.height, function (n) {
              return fonts[n] || '';
            });
            paint = {
              width: vp.width,
              height: vp.height,
              rects: raw.rects,
              lines: raw.lines,
              runs: window.ResumePaint.mergeRuns(raw.texts),
              images: images
            };
          } catch (e) { paint = null; }
          return { rules: rules, images: images, paint: paint };
        });
      }).catch(function () { return { rules: [], images: [], paint: null }; });

      return opsP.then(function (got) {
        var layout = null;
        try {
          layout = window.ResumePdfLayout.analyze({
            width: vp.width, height: vp.height, items: items,
            rules: got.rules, images: got.images
          });
        } catch (e) { layout = null; }
        if (layout && got.paint) layout.paint = got.paint;
        return { layout: layout, rows: simpleRows(items), paint: got.paint };
      });
    });
  }

  /** 兜底：没有版式分析时，把同基线的文字拼成一行 */
  function simpleRows(items) {
    var rows = new Map();
    items.forEach(function (it) {
      var y = Math.round(it.y / 3) * 3;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(it);
    });
    var ys = Array.from(rows.keys()).sort(function (a, b) { return b - a; });
    return ys.map(function (y) {
      return rows.get(y).sort(function (a, b) { return a.x - b.x; }).map(function (c) { return c.str; })
        .join(' ').replace(/\s{2,}/g, '  ').trim();
    }).filter(function (s) { return s; });
  }

  /** 资源目录的绝对地址：file:// 下相对路径无法被 worker 取到 */
  function assetUrl(rel) {
    try {
      var base = document.baseURI || location.href;
      return new URL(rel, base).href;
    } catch (e) {
      return rel;
    }
  }

  function pdfRead(buf) {
    return ensurePdfLib().then(function (conf) {
      var lib = window.pdfjsLib;
      lib.GlobalWorkerOptions.workerSrc = conf.worker;
      var opts = {
        data: buf,
        useSystemFonts: true,
        // 中文 PDF 大量依赖外部 CMap（如 GB-EUC-H）与标准字体，缺了会解析出乱码
        cMapUrl: assetUrl('vendor/cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: assetUrl('vendor/standard_fonts/')
      };
      return lib.getDocument(opts).promise;
    }).then(function (pdf) {
      var chain = Promise.resolve();
      var out = [];
      var layouts = [];
      var paints = [];

      for (var p = 1; p <= pdf.numPages; p++) {
        (function (num) {
          chain = chain.then(function () {
            return pdf.getPage(num).then(function (page) {
              return readPage(page, window.pdfjsLib);
            }).then(function (r) {
              if (r.paint) {
                r.paint.pageIndex = num - 1;
                paints.push(r.paint);
              }
              if (r.layout) {
                r.layout.pageIndex = num - 1;
                layouts.push(r.layout);
                // 正文文本直接用版式行（右对齐日期会被还原成独立字段，而不是混进正文）
                r.layout.lines.forEach(function (l) {
                  out.push(l.text + (l.right ? '\u3000\u3000' + l.right : ''));
                });
              } else {
                out = out.concat(r.rows);
              }
              out.push('');
            });
          });
        })(p);
      }

      return chain.then(function () {
        return {
          text: out.join('\n'), layout: layouts[0] || null, layouts: layouts,
          paints: paints, pages: pdf.numPages
        };
      });
    });
  }

  function pdfToText(buf) {
    return pdfRead(buf).then(function (r) { return r.text; });
  }

  /**
   * @param {File} file
   * @returns {Promise<{text:string, name:string, photo:string, kind:string, srcBuf:ArrayBuffer|null}>}
   */
  function readFile(file) {
    var name = file.name || '';
    var ext = (name.split('.').pop() || '').toLowerCase();

    if (ext === 'txt' || ext === 'md' || ext === 'markdown' || (file.type || '').indexOf('text/') === 0) {
      return file.text().then(function (t) {
        return { text: t, name: name, photo: '', kind: 'txt', srcBuf: null };
      });
    }
    if (ext === 'doc') {
      return Promise.reject(new Error('旧版 .doc 无法直接解析，请用 Word 另存为 .docx，或直接粘贴文本'));
    }
    if (ext === 'docx') {
      return file.arrayBuffer().then(function (buf) {
        return docxRead(buf).then(function (r) {
          return { text: r.text, name: name, photo: r.photo, kind: 'docx', srcBuf: buf };
        });
      });
    }
    if (ext === 'pdf') {
      return file.arrayBuffer().then(function (buf) {
        // pdf.js 会接管 buffer，复制一份避免 detach
        return pdfRead(buf.slice(0)).then(function (r) {
          if (r.text.replace(/\s/g, '').length < 40) {
            throw new Error('PDF 中未提取到有效文字，可能是扫描件。请直接粘贴文本');
          }
          // 证件照：优先第 1 页（简历里照片通常在首页），否则取第一张能识别出来的
          var lays = r.layouts || (r.layout ? [r.layout] : []);
          var photo = null;
          lays.forEach(function (pg) {
            if (pg.photo && pg.photo.data && pg.photo.pageIndex == null) {
              pg.photo.pageIndex = pg.pageIndex || 0;
            }
          });
          for (var i = 0; i < lays.length; i++) {
            if (lays[i].photo && lays[i].photo.data) { photo = lays[i].photo; break; }
          }
          return {
            text: r.text, name: name,
            photo: photo ? photo.data : '',
            kind: 'pdf', srcBuf: null,
            layout: lays[0] || null, layouts: lays, paints: r.paints || [], pages: r.pages
          };
        });
      });
    }
    return Promise.reject(new Error('暂不支持该格式，请使用 .docx / .pdf / .txt / .md'));
  }

  window.ResumeParse = { readFile: readFile, docxRead: docxRead };
})();

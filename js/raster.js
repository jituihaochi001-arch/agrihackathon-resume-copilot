/* raster.js — 把成稿渲染成位图（PNG）
 *
 * 复用 pdfwrite.js 的 collectScene：那份场景数据已经把每个文字行 / 色块 /
 * 边框 / 图片的真实版面位置量好了（单位是布局 px），所以这里只要照着画到
 * Canvas 上即可 —— 与 PDF 走的是同一套坐标，视觉上一致。
 *
 * 注意：文字逐字绘制（而不是整行 fillText），这样才能保留原版的字距与换行位置。
 */
(function (root) {
  'use strict';

  var PX2PT = 0.75;

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) { resolve(null); return; }
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function cssFont(op) {
    var weight = op.bold ? 700 : 400;
    var size = op.sizePx || (op.size / PX2PT);
    return weight + ' ' + size + 'px ' + (op.fam || 'sans-serif');
  }

  /**
   * 把场景画到 canvas。
   * @param {object} scene collectScene 的返回值
   * @param {number} w 画布宽（布局 px）
   * @param {number} h 画布高（布局 px）
   * @param {number} scale 放大倍数（2 = 高清）
   */
  async function paint(scene, w, h, scale) {
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    var ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.textBaseline = 'alphabetic';

    // 纸白底
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    // 图片先准备好（异步），画的时候直接取
    var imgs = {};
    var jobs = [];
    scene.ops.forEach(function (op) {
      if (op.t === 'img' && op.src && !imgs[op.src]) {
        imgs[op.src] = null;
        jobs.push(loadImage(op.src).then(function (im) { imgs[op.src] = im; }));
      }
    });
    if (jobs.length) await Promise.all(jobs);

    scene.ops.forEach(function (op) {
      if (op.t === 'rect') {
        ctx.fillStyle = 'rgb(' + Math.round(op.fill[0] * 255) + ',' +
          Math.round(op.fill[1] * 255) + ',' + Math.round(op.fill[2] * 255) + ')';
        ctx.fillRect(op.x, op.y, op.w, op.h);
      } else if (op.t === 'img') {
        var im = imgs[op.src];
        if (!im) return;
        try { ctx.drawImage(im, op.x, op.y, op.w, op.h); } catch (e) { /* 忽略单张失败 */ }
      } else if (op.t === 'text') {
        if (!op.chars || !op.chars.length) return;
        ctx.font = cssFont(op);
        ctx.fillStyle = 'rgb(' + Math.round(op.color[0] * 255) + ',' +
          Math.round(op.color[1] * 255) + ',' + Math.round(op.color[2] * 255) + ')';
        // 逐字定位：保留原版的字距与对齐
        op.chars.forEach(function (c) {
          var ch = String.fromCodePoint(c.cp);
          if (ch === ' ' || ch === '\n') return;
          ctx.fillText(ch, c.x, op.y);
          if (op.bold) ctx.fillText(ch, c.x + op.sizePx * 0.026, op.y);
        });
      }
    });

    return canvas;
  }

  /**
   * 生成 PNG Blob。
   * @param {HTMLElement} paper 预览里的 .paper
   * @param {object} opts { scale, height }
   */
  async function toPng(paper, opts) {
    opts = opts || {};
    if (!paper) throw new Error('没有可导出的成稿');
    var scene = root.ResumePdf.collectScene(paper);
    if (!scene.ops.length) throw new Error('成稿内容为空，无法生成图片');

    var scale = opts.scale || 2;
    var w = paper.offsetWidth || 794;
    var h = opts.height || paper.offsetHeight || 1123;

    var canvas = await paint(scene, w, h, scale);
    return await new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('PNG 生成失败'));
      }, 'image/png');
    });
  }

  root.ResumeRaster = { toPng: toPng, paint: paint };
})(typeof window !== 'undefined' ? window : this);

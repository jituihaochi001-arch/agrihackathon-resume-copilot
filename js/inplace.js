/* inplace.js — 在原 .docx 上原位替换文字：版式 / 字体 / 间距 / 照片全部保留 */
(function () {
  'use strict';

  var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  function norm(s) {
    return String(s || '')
      .replace(/[\s\u00a0\u3000]/g, '')
      .replace(/^[·•▪◦※*+\-–—]+/, '');
  }

  /* ---------------- 段落读写 ---------------- */

  /** 段落自身的文字（跳过文本框里的嵌套段落） */
  function paraText(p) {
    var out = '';
    (function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (c.namespaceURI === W) {
          if (c.localName === 'p') continue;
          if (c.localName === 't') { out += c.textContent; continue; }
          if (c.localName === 'tab') { out += '\t'; continue; }
          if (c.localName === 'br' || c.localName === 'cr') { out += '\n'; continue; }
          if (c.localName === 'del' || c.localName === 'instrText') continue;
        }
        walk(c);
      }
    })(p);
    return out;
  }

  function ownTextNodes(p) {
    var out = [];
    (function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        if (c.namespaceURI === W) {
          if (c.localName === 'p') continue;
          if (c.localName === 't') { out.push(c); continue; }
          if (c.localName === 'del') continue;
        }
        walk(c);
      }
    })(p);
    return out;
  }

  function setParaText(p, text) {
    var ts = ownTextNodes(p);
    if (!ts.length) {
      var doc = p.ownerDocument;
      var run = doc.createElementNS(W, 'w:r');
      var t = doc.createElementNS(W, 'w:t');
      t.setAttribute('xml:space', 'preserve');
      t.textContent = text;
      run.appendChild(t);
      var pPr = null;
      for (var c = p.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 1 && c.namespaceURI === W && c.localName === 'pPr') { pPr = c; break; }
      }
      if (pPr && pPr.nextSibling) p.insertBefore(run, pPr.nextSibling);
      else p.appendChild(run);
      return;
    }
    ts[0].setAttribute('xml:space', 'preserve');
    ts[0].textContent = text;
    for (var i = 1; i < ts.length; i++) ts[i].textContent = '';
  }

  /** 在单个文字节点内做子串替换，成功返回 true */
  function replaceInRuns(p, from, to) {
    var ts = ownTextNodes(p);
    for (var i = 0; i < ts.length; i++) {
      var s = ts[i].textContent;
      if (s.indexOf(from) < 0) continue;
      ts[i].setAttribute('xml:space', 'preserve');
      ts[i].textContent = s.replace(from, to);
      return true;
    }
    return false;
  }

  /* ---------------- 差异比对 ---------------- */

  function headOk(a, b) {
    if (a.indexOf(b) === 0) return true;
    // 拆分时第一段的动词可能同时被替换（负责→统筹），允许前 2 字不同
    var probe = b.slice(2, 8);
    if (probe.length < 4) return false;
    var at = a.indexOf(probe);
    return at >= 0 && at <= 3;
  }

  function isSplit(o, n1, n2) {
    var a = norm(o), b = norm(n1), c = norm(n2);
    if (!a || !b || !c) return false;
    if (b.length < 6 || c.length < 4) return false;
    var isSuffix = a.length >= c.length && a.lastIndexOf(c) === a.length - c.length;
    if (!isSuffix) {
      // 中间允许吃掉一个标点
      if (a.indexOf(c) < b.length - 2) return false;
    }
    return headOk(a, b);
  }

  function diffBullets(oldArr, newArr, ops) {
    var i = 0, j = 0, lastFrom = '';
    while (i < oldArr.length || j < newArr.length) {
      if (i >= oldArr.length) {
        // 多出来的要点：克隆上一段插入
        if (lastFrom && norm(newArr[j])) ops.push({ kind: 'insert', after: lastFrom, text: newArr[j] });
        j++; continue;
      }
      if (j >= newArr.length) {
        if (norm(oldArr[i])) ops.push({ kind: 'para', from: oldArr[i], to: '' });
        i++; continue;
      }
      var o = oldArr[i], n = newArr[j], n2 = newArr[j + 1];
      if (norm(o) === norm(n)) { lastFrom = o; i++; j++; continue; }
      if (n2 !== undefined && isSplit(o, n, n2)) {
        ops.push({ kind: 'split', from: o, to: [n, n2] });
        lastFrom = o; i++; j += 2; continue;
      }
      if (oldArr[i + 1] !== undefined && norm(oldArr[i + 1]) === norm(n)) {
        if (norm(o)) ops.push({ kind: 'para', from: o, to: '' });
        i++; continue;
      }
      if (norm(o)) ops.push({ kind: 'para', from: o, to: n });
      lastFrom = o; i++; j++;
    }
  }

  function collectOps(base, model) {
    var ops = [];
    var byUid = {};
    model.sections.forEach(function (s) { byUid[s.uid] = s; });

    base.sections.forEach(function (bs) {
      var ns = byUid[bs.uid];
      if (!ns) return;

      if (bs.mode === 'para' && ns.mode === 'para' && bs.text && ns.text && norm(bs.text) !== norm(ns.text)) {
        ops.push({ kind: 'para', from: bs.text, to: ns.text });
      }

      if (bs.mode === 'entries' && ns.mode === 'entries') {
        var ni = {};
        ns.items.forEach(function (it) { ni[it.uid] = it; });
        bs.items.forEach(function (bi) {
          var it = ni[bi.uid];
          if (!it) return;
          if (bi.meta && it.meta && bi.meta !== it.meta) ops.push({ kind: 'sub', from: bi.meta, to: it.meta });
          diffBullets(bi.bullets, it.bullets, ops);
        });
      }
    });
    return ops;
  }

  /* ---------------- 应用到 XML ---------------- */

  function applyOps(doc, ops) {
    var paras = Array.prototype.slice.call(doc.getElementsByTagNameNS(W, 'p'));
    var buckets = Object.create(null);
    paras.forEach(function (p) {
      var k = norm(paraText(p));
      if (!k) return;
      (buckets[k] || (buckets[k] = [])).push(p);
    });

    var rec = { total: ops.length, applied: 0, missing: [] };

    ops.forEach(function (op) {
      if (op.kind === 'para') {
        var key = norm(op.from);
        var list = buckets[key];
        if (!list || !list.length) { rec.missing.push(op.from); return; }
        var p = list.shift();
        if (!op.to) {
          if (p.parentNode) p.parentNode.removeChild(p);
          rec.applied++;
          return;
        }
        setParaText(p, op.to);
        // 删除后重新入桶，避免同文本重复命中
        var nk = norm(op.to);
        (buckets[nk] || (buckets[nk] = [])).push(p);
        rec.applied++;
        return;
      }

      if (op.kind === 'split') {
        var k2 = norm(op.from);
        var l2 = buckets[k2];
        if (!l2 || !l2.length) { rec.missing.push(op.from); return; }
        var p2 = l2.shift();
        setParaText(p2, op.to[0]);
        var clone = p2.cloneNode(true);
        setParaText(clone, op.to[1]);
        if (p2.parentNode) p2.parentNode.insertBefore(clone, p2.nextSibling);
        rec.applied++;
        return;
      }

      if (op.kind === 'insert') {
        var ka = norm(op.after);
        var la = buckets[ka];
        var host = la && la.length ? la[0] : null;
        if (!host || !host.parentNode) { rec.missing.push(op.text); return; }
        var cnode = host.cloneNode(true);
        setParaText(cnode, op.text);
        host.parentNode.insertBefore(cnode, host.nextSibling);
        rec.applied++;
        return;
      }

      // sub：在段落内替换一小段（日期、城市等）
      var done = false;
      for (var i = 0; i < paras.length && !done; i++) {
        var pi = paras[i];
        if (!pi.parentNode) continue;
        if (pi.textContent.indexOf(op.from) < 0) continue;
        if (replaceInRuns(pi, op.from, op.to)) { done = true; break; }
        var full = paraText(pi);
        if (full.indexOf(op.from) >= 0) { setParaText(pi, full.replace(op.from, op.to)); done = true; }
      }
      if (done) rec.applied++;
      else rec.missing.push(op.from);
    });

    return rec;
  }

  /* ---------------- 对外 ---------------- */

  /**
   * @param {object} base   原始解析模型（未被修改）
   * @param {object} model  采纳建议后的模型
   * @param {ArrayBuffer} srcBuf 原始 .docx
   * @returns {Promise<{blob:Blob, applied:number, total:number, missing:string[]}>}
   */
  function build(base, model, srcBuf) {
    return window.MiniZip.unzip(srcBuf).then(function (files) {
      var docFile = files.get('word/document.xml');
      if (!docFile) throw new Error('原文件中未找到正文');

      var dec = new TextDecoder('utf-8');
      var xml = dec.decode(docFile);
      var doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) throw new Error('原文档结构解析失败');

      var ops = collectOps(base, model);
      var rec = applyOps(doc, ops);

      var ser = new XMLSerializer().serializeToString(doc);
      if (ser.indexOf('<?xml') !== 0) {
        ser = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + ser;
      }

      var enc = new TextEncoder();
      var out = [];
      var replaced = false;
      files.forEach(function (data, name) {
        if (name === 'word/document.xml') { out.push({ name: name, data: enc.encode(ser) }); replaced = true; }
        else out.push({ name: name, data: data });
      });
      if (!replaced) out.push({ name: 'word/document.xml', data: enc.encode(ser) });

      return {
        blob: window.MiniZip.zipStore(out),
        applied: rec.applied,
        total: rec.total,
        missing: rec.missing
      };
    });
  }

  window.ResumeInplace = { build: build, collectOps: collectOps, paraText: paraText };
})();

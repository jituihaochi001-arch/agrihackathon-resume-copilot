/* ttfs.js — 浏览器端 TrueType 二次子集化
 *
 * 用途：内置一份中文字体全集（压缩后随需加载），导出 PDF 时按本次简历
 * 实际用到的字符裁出一份只含这些字形的迷你字体，再嵌入 PDF。
 * 好处：PDF 体积只有几十 KB，而不是几 MB。
 *
 * 只处理 PDF 嵌入需要的最小表集：head / hhea / maxp / hmtx / cmap / loca / glyf。
 */
(function (root) {
  'use strict';

  /* ---------- 字节读取 ---------- */

  function Reader(buf) {
    this.dv = new DataView(buf);
    this.u8 = new Uint8Array(buf);
    this.p = 0;
  }
  Reader.prototype.u16 = function (o) { return this.dv.getUint16(o || this.p, false); };
  Reader.prototype.i16 = function (o) { return this.dv.getInt16(o || this.p, false); };
  Reader.prototype.u32 = function (o) { return this.dv.getUint32(o || this.p, false); };
  Reader.prototype.tag = function (o) {
    var s = '';
    for (var i = 0; i < 4; i++) s += String.fromCharCode(this.u8[(o || this.p) + i]);
    return s;
  };

  /* ---------- 表目录 ---------- */

  function parseTables(buf) {
    var r = new Reader(buf);
    var ver = r.u32(0);
    var num = r.u16(4);
    var tables = {};
    for (var i = 0; i < num; i++) {
      var off = 12 + i * 16;
      var tag = r.tag(off);
      tables[tag] = { offset: r.u32(off + 8), length: r.u32(off + 12) };
    }
    return { tables: tables, numTables: num, sfnt: ver };
  }

  function tableChecksum(u8, off, len) {
    var sum = 0;
    var end = off + len;
    for (var i = off; i < end; i += 4) {
      var v = (u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3];
      sum = (sum + v) >>> 0;
    }
    return sum >>> 0;
  }

  /* ---------- cmap ---------- */

  /** 读取 cmap，建 unicode → glyphId 映射（支持 format 4 / 12） */
  function parseCmap(buf, cmapOff) {
    var dv = new DataView(buf);
    var n = dv.getUint16(cmapOff + 2, false);
    var subs = [];
    for (var i = 0; i < n; i++) {
      var rec = cmapOff + 4 + i * 8;
      var platform = dv.getUint16(rec, false);
      var encoding = dv.getUint16(rec + 2, false);
      var offset = dv.getUint32(rec + 4, false);
      subs.push({ platform: platform, encoding: encoding, offset: cmapOff + offset });
    }

    var map = {};
    // 优先 format 12（覆盖全部 BMP+），其次 format 4
    var order = [];
    subs.forEach(function (s) {
      var fmt = dv.getUint16(s.offset, false);
      if (fmt === 12) order.unshift(s);
      else if (fmt === 4) order.push(s);
    });
    order.forEach(function (s) {
      var fmt = dv.getUint16(s.offset, false);
      if (fmt === 4) readCmap4(buf, s.offset, map);
      else if (fmt === 12) readCmap12(buf, s.offset, map);
    });
    return map;
  }

  function readCmap4(buf, off, map) {
    var dv = new DataView(buf);
    var segX2 = dv.getUint16(off + 6, false);
    var seg = segX2 / 2;
    // 规范布局（reservedPad 只在 endCode 与 startCode 之间各一处）：
    //   off+14            endCode[segCount]
    //   +segX2+2          reservedPad
    //   off+16+segX2      startCode[segCount]
    //   off+16+segX2*2    idDelta[segCount]
    //   off+16+segX2*3    idRangeOffset[segCount]
    var endP = off + 14;
    var startP = endP + segX2 + 2;
    var deltaP = startP + segX2;
    var rangeP = deltaP + segX2;

    for (var i = 0; i < seg; i++) {
      var end = dv.getUint16(endP + i * 2, false);
      var start = dv.getUint16(startP + i * 2, false);
      if (start === 0xffff) continue;
      var delta = dv.getInt16(deltaP + i * 2, false);
      var rangeOff = dv.getUint16(rangeP + i * 2, false);

      for (var c = start; c <= end && c !== 0x10000; c++) {
        var gid;
        if (rangeOff === 0) {
          gid = (c + delta) & 0xffff;
        } else {
          var gAddr = rangeP + i * 2 + rangeOff + (c - start) * 2;
          if (gAddr + 1 >= buf.byteLength) continue;
          var g = dv.getUint16(gAddr, false);
          if (g === 0) continue;
          gid = (g + delta) & 0xffff;
        }
        if (gid && !map[c]) map[c] = gid;
      }
    }
  }

  function readCmap12(buf, off, map) {
    var dv = new DataView(buf);
    var nGroups = dv.getUint32(off + 12, false);
    var p = off + 16;
    for (var i = 0; i < nGroups; i++) {
      var start = dv.getUint32(p, false);
      var end = dv.getUint32(p + 4, false);
      var gid = dv.getUint32(p + 8, false);
      for (var c = start; c <= end; c++) {
        if (!map[c]) map[c] = gid + (c - start);
      }
      p += 12;
    }
  }

  /* ---------- 字体子集化 ---------- */

  /**
   * @param {ArrayBuffer} buf  原始 TTF
   * @param {Array<number>} codes  需要保留的 Unicode 码位
   * @returns {{buffer:ArrayBuffer, gidOf:Object, widths:Object, upem:number, numGlyphs:number}}
   */
  function subset(buf, codes) {
    var t = parseTables(buf);
    var tb = t.tables;
    var u8 = new Uint8Array(buf);

    var cmap = parseCmap(buf, tb.cmap.offset);
    var head = tb.head, hhea = tb.hhea, maxp = tb.maxp, hmtx = tb.hmtx, loca = tb.loca, glyf = tb.glyf;

    var numGlyphs = new DataView(buf).getUint16(maxp.offset + 4, false);
    var indexToLocFormat = new DataView(buf).getInt16(head.offset + 50, false);
    var upem = new DataView(buf).getUint16(head.offset + 18, false);

    // loca → 每个字形的字节区间
    var offsets = new Uint32Array(numGlyphs + 1);
    for (var i = 0; i <= numGlyphs; i++) {
      offsets[i] = indexToLocFormat === 0
        ? new DataView(buf).getUint16(loca.offset + i * 2, false) * 2
        : new DataView(buf).getUint32(loca.offset + i * 4, false);
    }

    // 挑出需要的字形（复合字形的组件在后面统一补进来）
    var keep = new Uint8Array(numGlyphs);
    var gidList = [0];              // 0 = .notdef，永远保留
    keep[0] = 1;

    codes.forEach(function (c) {
      var g = cmap[c];
      if (g && g < numGlyphs && !keep[g]) { keep[g] = 1; gidList.push(g); }
    });

    var order = gidList.filter(function (g, i, arr) { return arr.indexOf(g) === i; });

    // 复合字形依赖：扫描组件引用，把组件 gid 一并纳入
    var extra = [];
    order.forEach(function (g) {
      if (g === 0) return;
      var s = offsets[g], e = offsets[g + 1];
      if (e <= s) return;
      var nc = new DataView(buf).getInt16(glyf.offset + s, false);
      if (nc >= 0) return;                        // 简单字形，无需组件
      var pp = glyf.offset + s + 10;
      var fl = new DataView(buf).getUint16(pp, false);
      pp += 2;
      var bits = 0;
      while (fl & (1 << bits)) bits++;
      if (bits === 0) bits = 2;
      pp += bits * 2;
      var more = true;
      while (more) {
        fl = new DataView(buf).getUint16(pp, false);
        pp += 2;
        var cg = new DataView(buf).getUint16(pp, false);
        if (cg < numGlyphs && !keep[cg]) { keep[cg] = 1; extra.push(cg); }
        pp += 2;
        if (fl & 1) pp += 2; else pp += 1;
        if (fl & 8) pp += 2; else if (fl & 0x40) pp += 1;
        if (fl & 2) pp += 2;
        more = !!(fl & 0x20);
      }
    });
    order = order.concat(extra);
    order = order.filter(function (g, i, arr) { return arr.indexOf(g) === i; });

    // 建立新 gid 映射
    var newGid = Object.create(null);
    order.forEach(function (g, idx) { newGid[g] = idx; });

    // 组装 glyf / loca
    var glyfParts = [];
    var newLoca = [0];
    var total = 0;
    order.forEach(function (g) {
      var s = offsets[g], e = offsets[g + 1];
      var len = e - s;
      if (len > 0) {
        var part = u8.slice(glyf.offset + s, glyf.offset + e);
        // 复合字形里的组件 gid 要重映射
        if (len > 0 && new DataView(part.buffer, part.byteOffset).getInt16(0, false) < 0) {
          var dv = new DataView(part.buffer, part.byteOffset);
          var pp = 10;
          var fl = dv.getUint16(pp, false); pp += 2;
          var bits = 0;
          while (fl & (1 << bits)) bits++;
          if (bits === 0) bits = 2;
          pp += bits * 2;
          var more = true;
          while (more) {
            fl = dv.getUint16(pp, false);
            var cg = dv.getUint16(pp + 2, false);
            if (newGid[cg] !== undefined) dv.setUint16(pp + 2, newGid[cg], false);
            pp += 4;
            if (fl & 1) pp += 2; else pp += 1;
            if (fl & 8) pp += 2; else if (fl & 0x40) pp += 1;
            if (fl & 2) pp += 2;
            more = !!(fl & 0x20);
          }
        }
        glyfParts.push(part);
        total += part.length;
        if (total % 4 !== 0) { var pad = new Uint8Array(4 - (total % 4)); glyfParts.push(pad); total += pad.length; }
      }
      newLoca.push(total);
    });

    var newGlyf = concat(glyfParts, total);

    // hmtx：advance width
    var numberOfHMetrics = new DataView(buf).getUint16(hhea.offset + 34, false);
    var oldWidth = function (g) {
      if (g < numberOfHMetrics) {
        return new DataView(buf).getUint16(hmtx.offset + g * 4, false);
      }
      return new DataView(buf).getUint16(hmtx.offset + (numberOfHMetrics - 1) * 4, false);
    };
    var widths = Object.create(null);
    var hmtxParts = [];
    order.forEach(function (g) {
      var w = oldWidth(g);
      widths[newGid[g]] = w;
      var b = new Uint8Array(4);
      new DataView(b.buffer).setUint16(0, w, false);
      new DataView(b.buffer).setInt16(2, 0, false);   // lsb（近似）
      hmtxParts.push(b);
    });
    var newHmtx = concat(hmtxParts, hmtxParts.length * 4);

    // 记录码位 → 新 gid
    var gidOf = Object.create(null);
    var gidMapBmp = Object.create(null);
    Object.keys(cmap).forEach(function (cp) {
      var g = cmap[cp];
      if (newGid[g] !== undefined) {
        gidOf[cp] = newGid[g];
        if (Number(cp) <= 0xffff) gidMapBmp[cp] = newGid[g];
      }
    });

    return {
      buffer: buildFont({
        buf: buf, tb: tb, u8: u8,
        newGlyf: newGlyf, newLoca: newLoca, newHmtx: newHmtx,
        numGlyphs: order.length, upem: upem, keep: keep,
        gidMapBmp: gidMapBmp
      }),
      gidOf: gidOf,
      widths: widths,
      upem: upem,
      numGlyphs: order.length
    };
  }

  function concat(parts, len) {
    var out = new Uint8Array(len);
    var p = 0;
    for (var i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
    return out;
  }

  /* ---------- 重新组装 TTF ---------- */

  function buildFont(o) {
    var buf = o.buf, tb = o.tb, u8 = o.u8;
    var dv = new DataView(buf);

    // 重建 head（改 indexToLocFormat=1、indexToLocSize）
    var headLen = tb.head.length;
    var newHead = u8.slice(tb.head.offset, tb.head.offset + headLen);
    var headDV = new DataView(newHead.buffer);
    headDV.setInt16(50, 1, false);            // indexToLocFormat = long

    // hhea：改 numberOfHMetrics
    var newHhea = u8.slice(tb.hhea.offset, tb.hhea.offset + tb.hhea.length);
    new DataView(newHhea.buffer).setUint16(34, o.numGlyphs, false);

    // maxp：改 numGlyphs
    var newMaxp = u8.slice(tb.maxp.offset, tb.maxp.offset + tb.maxp.length);
    new DataView(newMaxp.buffer).setUint16(4, o.numGlyphs, false);

    // loca
    var locaBytes = new Uint8Array((o.numGlyphs + 1) * 4);
    var locaDV = new DataView(locaBytes.buffer);
    for (var i = 0; i <= o.numGlyphs; i++) locaDV.setUint32(i * 4, o.newLoca[i], false);

    // cmap：重建为 format 4（只含 BMP）
    var newCmap = buildCmap4(o.gidMapBmp || {});

    var out = {
      'head': newHead, 'hhea': newHhea, 'maxp': newMaxp,
      'hmtx': o.newHmtx, 'loca': locaBytes, 'glyf': o.newGlyf,
      'cmap': newCmap
    };
    // 保留 OS/2 与 post（部分阅读器需要）
    ['OS/2', 'post', 'name'].forEach(function (tag) {
      if (tb[tag]) out[tag] = u8.slice(tb[tag].offset, tb[tag].offset + tb[tag].length);
    });

    var tags = Object.keys(out);
    var num = tags.length;
    var searchRange = 1, entrySel = 0;
    while (searchRange * 2 <= num) { searchRange *= 2; entrySel++; }
    searchRange *= 16;
    var rangeShift = num * 16 - searchRange;

    var headerLen = 12 + num * 16;
    var total = headerLen;
    var offsets = {};
    tags.forEach(function (tag) {
      var len = out[tag].length;
      offsets[tag] = total;
      total += len + ((4 - (len % 4)) % 4);
    });

    var bytes = new Uint8Array(total);
    var oDV = new DataView(bytes.buffer);
    oDV.setUint32(0, 0x00010000, false);
    oDV.setUint16(4, num, false);
    oDV.setUint16(6, searchRange, false);
    oDV.setUint16(8, entrySel, false);
    oDV.setUint16(10, rangeShift, false);

    var sorted = tags.slice().sort();
    sorted.forEach(function (tag, i) {
      var p = 12 + i * 16;
      for (var c = 0; c < 4; c++) bytes[p + c] = tag.charCodeAt(c);
      oDV.setUint32(p + 4, tableChecksum(out[tag], 0, out[tag].length), false);
      oDV.setUint32(p + 8, offsets[tag], false);
      oDV.setUint32(p + 12, out[tag].length, false);
    });

    tags.forEach(function (tag) {
      bytes.set(out[tag], offsets[tag]);
    });

    return bytes.buffer;
  }

  /** 构造 cmap format 4 */
  function buildCmap4(map) {
    // map: {codePoint: gid}
    var codes = Object.keys(map).map(Number).filter(function (c) { return c <= 0xffff && c > 0; }).sort(function (a, b) { return a - b; });
    var segs = [];
    var i = 0;
    while (i < codes.length) {
      var start = codes[i], end = codes[i], gid = map[codes[i]];
      var j = i + 1;
      while (j < codes.length && codes[j] === end + 1 && map[codes[j]] === gid + (end + 1 - start)) {
        end = codes[j]; j++;
      }
      segs.push({ start: start, end: end, delta: (gid - start) & 0xffff });
      i = j;
    }
    segs.push({ start: 0xffff, end: 0xffff, delta: 1 });

    var segCount = segs.length;
    // format 4 子表布局（严格按 OpenType 规范）：
    //   头 14B = format/length/language/segCountX2/searchRange/entrySelector/rangeShift
    //   endCode[segCount] + reservedPad + startCode[segCount] + idDelta[segCount] + idRangeOffset[segCount]
    //   总长 = 14 + segCount*8 + 2
    var HDR = 14;
    var sub = new Uint8Array(HDR + segCount * 8 + 2);
    var dv = new DataView(sub.buffer);
    dv.setUint16(0, 4, false);
    dv.setUint16(2, sub.length, false);
    dv.setUint16(4, 0, false);
    dv.setUint16(6, segCount * 2, false);
    var sr = 1, es = 0;
    while (sr * 2 <= segCount) { sr *= 2; es++; }
    dv.setUint16(8, sr * 2, false);
    dv.setUint16(10, es, false);
    dv.setUint16(12, segCount * 2 - sr * 2, false);

    // 严格按规范顺序写入，每写一个 uint16 就断言指针未越界
    var p = HDR;
    var put = function (v) {
      if (p + 2 > sub.length) throw new Error('cmap4 段数组越界 @' + p + '/' + sub.length);
      dv.setUint16(p, v & 0xffff, false);
      p += 2;
    };
    segs.forEach(function (s) { put(s.end); });   // endCode[]
    put(0);                                       // reservedPad
    segs.forEach(function (s) { put(s.start); }); // startCode[]
    segs.forEach(function (s) { put(s.delta); }); // idDelta[]
    segs.forEach(function () { put(0); });        // idRangeOffset[] 全 0
    if (p !== sub.length) throw new Error('cmap4 长度不符 @' + p + '/' + sub.length);

    // 组装 cmap 表头：版本 + 2 条编码记录，每条 8 字节 → 20 字节
    var total = 20 + sub.length;
    var out = new Uint8Array(total);
    var oDV = new DataView(out.buffer);
    oDV.setUint16(0, 0, false);
    oDV.setUint16(2, 2, false);           // 2 个编码记录
    // (3,1) BMP
    oDV.setUint16(4, 3, false);
    oDV.setUint16(6, 1, false);
    oDV.setUint32(8, 20, false);
    // (3,10) 也指同一份
    oDV.setUint16(12, 3, false);
    oDV.setUint16(14, 10, false);
    oDV.setUint32(16, 20, false);
    out.set(sub, 20);
    return out;
  }

  var api = { subset: subset, parseCmap: parseCmap, parseTables: parseTables };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ResumeTTF = api;
})(typeof window !== 'undefined' ? window : this);

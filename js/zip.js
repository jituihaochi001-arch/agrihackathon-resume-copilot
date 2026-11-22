/* zip.js — 原生 ZIP 读写（STORE 写 / deflate-raw 读），无第三方依赖 */
(function () {
  'use strict';

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(u8) {
    var c = 0xffffffff;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持解压，请改用 .txt 粘贴或使用新版 Chrome / Edge');
    }
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([u8]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  /** 解压 ZIP → Map<文件名, Uint8Array> */
  async function unzip(buffer) {
    var u8 = new Uint8Array(buffer);
    var dv = new DataView(buffer);
    var eocd = -1;
    var min = Math.max(0, u8.length - 66000);
    for (var i = u8.length - 22; i >= min; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的压缩包');

    var count = dv.getUint16(eocd + 10, true);
    var off = dv.getUint32(eocd + 16, true);
    var files = new Map();
    var dec = new TextDecoder('utf-8');

    for (var n = 0; n < count; n++) {
      if (off + 46 > u8.length || dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true);
      var csize = dv.getUint32(off + 20, true);
      var nameLen = dv.getUint16(off + 28, true);
      var extraLen = dv.getUint16(off + 30, true);
      var commentLen = dv.getUint16(off + 32, true);
      var lho = dv.getUint32(off + 42, true);
      var name = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));

      if (lho + 30 <= u8.length) {
        var lnameLen = dv.getUint16(lho + 26, true);
        var lextraLen = dv.getUint16(lho + 28, true);
        var start = lho + 30 + lnameLen + lextraLen;
        var raw = u8.subarray(start, start + csize);
        if (!/\/$/.test(name) && csize > 0) {
          files.set(name, method === 0 ? raw : await inflateRaw(raw));
        }
      }
      off += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  /** 打包 ZIP（STORE，不压缩） */
  function zipStore(files) {
    var enc = new TextEncoder();
    var chunks = [];
    var central = [];
    var offset = 0;

    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var data = f.data;
      var crc = crc32(data);

      var lh = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);   // UTF-8 flag
      lv.setUint16(8, 0, true);        // store
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0x21, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);

      chunks.push(lh, data);
      central.push(cd);
      offset += lh.length + data.length;
    });

    var cdSize = central.reduce(function (n, c) { return n + c.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    return new Blob(chunks.concat(central, [eocd]), {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
  }

  window.MiniZip = { unzip: unzip, zipStore: zipStore, crc32: crc32 };
})();

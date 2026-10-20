/* =====================================================================
 * zip.js — a 90-line ZIP writer, store-only (no compression).
 *
 * The point of the download is one file that unpacks into the ESPHome
 * folder ready to build: the YAML, its README,
 * and the fan sprite. A library would do it, but this page has to run from
 * a double-clicked file with no network, so it carries its own.
 *
 * Store-only is fine here — the payload is a text file and twelve PNGs,
 * and PNG is already compressed.
 * ===================================================================== */
(function (PF) {
  'use strict';

  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  function b64(str) {
    var bin = atob(str);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* MS-DOS date/time. The epoch is 1980, and a file stamped before that
   * makes some unzippers complain, so clamp. */
  function dosTime(d) {
    var y = Math.max(1980, d.getFullYear());
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function w16(a, o, v) { a[o] = v & 255; a[o + 1] = (v >> 8) & 255; }
  function w32(a, o, v) { a[o] = v & 255; a[o + 1] = (v >> 8) & 255; a[o + 2] = (v >> 16) & 255; a[o + 3] = (v >>> 24) & 255; }

  /* files: [{ name: 'a/b.txt', data: Uint8Array | string }] */
  function build(files) {
    var stamp = dosTime(new Date());
    var parts = [], central = [], offset = 0;

    files.forEach(function (f) {
      var data = typeof f.data === 'string' ? utf8(f.data) : f.data;
      var name = utf8(f.name);
      var crc = crc32(data);

      var lh = new Uint8Array(30 + name.length);
      w32(lh, 0, 0x04034B50);
      w16(lh, 4, 20);                 /* version needed */
      w16(lh, 6, 0x0800);             /* UTF-8 names */
      w16(lh, 8, 0);                  /* stored */
      w16(lh, 10, stamp.time);
      w16(lh, 12, stamp.date);
      w32(lh, 14, crc);
      w32(lh, 18, data.length);
      w32(lh, 22, data.length);
      w16(lh, 26, name.length);
      w16(lh, 28, 0);
      lh.set(name, 30);

      var ch = new Uint8Array(46 + name.length);
      w32(ch, 0, 0x02014B50);
      w16(ch, 4, 20);
      w16(ch, 6, 20);
      w16(ch, 8, 0x0800);
      w16(ch, 10, 0);
      w16(ch, 12, stamp.time);
      w16(ch, 14, stamp.date);
      w32(ch, 16, crc);
      w32(ch, 20, data.length);
      w32(ch, 24, data.length);
      w16(ch, 28, name.length);
      w32(ch, 42, offset);
      ch.set(name, 46);

      parts.push(lh, data);
      central.push(ch);
      offset += lh.length + data.length;
    });

    var cdSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var end = new Uint8Array(22);
    w32(end, 0, 0x06054B50);
    w16(end, 8, files.length);
    w16(end, 10, files.length);
    w32(end, 12, cdSize);
    w32(end, 16, offset);

    return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
  }

  PF.zip = { build: build, b64: b64, utf8: utf8 };
})(window.PF = window.PF || {});

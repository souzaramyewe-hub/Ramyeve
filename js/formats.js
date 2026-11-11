/*
 * Formatos de download: MP3 (lamejs), WAV 16/24 bits, FLAC (codificador próprio)
 * e ZIP com as faixas separadas. Tudo é codificado no navegador.
 */
(function (global) {
  'use strict';

  const tick = () => new Promise((r) => setTimeout(r, 0));

  /* ================= WAV ================= */

  function wav(mix, bits) {
    const { L, R, sr } = mix;
    const bytes = bits === 24 ? 3 : 2;
    const len = L.length;
    const dataLen = len * 2 * bytes;
    const buf = new ArrayBuffer(44 + dataLen);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2 * bytes, true); v.setUint16(32, 2 * bytes, true); v.setUint16(34, bits, true);
    w(36, 'data'); v.setUint32(40, dataLen, true);
    let o = 44;
    const max = bits === 24 ? 0x7fffff : 0x7fff;
    for (let i = 0; i < len; i++) {
      for (const ch of [L, R]) {
        const s = Math.round(Math.max(-1, Math.min(1, ch[i])) * max);
        if (bytes === 2) v.setInt16(o, s, true);
        else { v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); }
        o += bytes;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  function toInt16(x, a, b) {
    const out = new Int16Array(b - a);
    for (let i = a; i < b; i++) {
      const s = Math.max(-1, Math.min(1, x[i]));
      out[i - a] = Math.round(s * 0x7fff); // mesmo arredondamento do WAV
    }
    return out;
  }

  /* ================= MP3 ================= */

  async function mp3(mix, kbps, onProgress) {
    if (!global.lamejs) throw new Error('Codificador MP3 não carregado.');
    const { L, R, sr } = mix;
    const enc = new global.lamejs.Mp3Encoder(2, sr, kbps || 192);
    const parts = [];
    const block = 1152 * 64;
    for (let i = 0; i < L.length; i += block) {
      const end = Math.min(L.length, i + block);
      const out = enc.encodeBuffer(toInt16(L, i, end), toInt16(R, i, end));
      if (out.length) parts.push(new Uint8Array(out));
      if (onProgress) onProgress(end / L.length);
      await tick();
    }
    const last = enc.flush();
    if (last.length) parts.push(new Uint8Array(last));
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  /* ================= FLAC ================= */

  const CRC8 = new Uint8Array(256), CRC16 = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    CRC8[i] = c;
    let d = i << 8;
    for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xffff : (d << 1) & 0xffff;
    CRC16[i] = d;
  }

  class BitWriter {
    constructor(size) { this.buf = new Uint8Array(size || 65536); this.pos = 0; this.acc = 0; this.n = 0; }
    ensure(extra) {
      if (this.pos + extra < this.buf.length) return;
      const nb = new Uint8Array(Math.max(this.buf.length * 2, this.pos + extra + 1024));
      nb.set(this.buf.subarray(0, this.pos)); this.buf = nb;
    }
    bits(value, count) { // count <= 24 por chamada
      while (count > 24) { const hi = count - 24; this.bits(Math.floor(value / 2 ** 24) & ((1 << hi) - 1), hi); value = value % 2 ** 24; count = 24; }
      this.acc = (this.acc * (1 << count)) + (value & ((1 << count) - 1));
      this.n += count;
      this.ensure(8);
      while (this.n >= 8) {
        this.n -= 8;
        this.buf[this.pos++] = Math.floor(this.acc / 2 ** this.n) & 0xff;
        this.acc = this.acc % 2 ** this.n;
      }
    }
    signed(value, count) { this.bits(value < 0 ? value + 2 ** count : value, count); }
    unary(q) { // q zeros e depois 1
      while (q >= 24) { this.bits(0, 24); q -= 24; }
      this.bits(1, q + 1);
    }
    align() { if (this.n) this.bits(0, 8 - this.n); }
    bytes() { return this.buf.subarray(0, this.pos); }
  }

  const BLOCK = 4096;

  function residual(x, order) {
    const n = x.length, e = new Int32Array(n);
    for (let i = order; i < n; i++) {
      switch (order) {
        case 0: e[i] = x[i]; break;
        case 1: e[i] = x[i] - x[i - 1]; break;
        case 2: e[i] = x[i] - 2 * x[i - 1] + x[i - 2]; break;
        case 3: e[i] = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; break;
        default: e[i] = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
      }
    }
    return e;
  }

  function riceCost(e, a, b, k) {
    let bits = 0;
    for (let i = a; i < b; i++) { const v = e[i], u = v >= 0 ? 2 * v : -2 * v - 1; bits += (u >>> k) + 1 + k; }
    return bits;
  }

  function bestRice(e, a, b) {
    let sum = 0;
    for (let i = a; i < b; i++) { const v = e[i]; sum += v >= 0 ? 2 * v : -2 * v - 1; }
    const mean = sum / Math.max(1, b - a);
    let k = mean > 1 ? Math.min(14, Math.floor(Math.log2(mean))) : 0;
    let best = { k, bits: riceCost(e, a, b, k) };
    for (const kk of [k + 1]) {
      if (kk < 0 || kk > 14) continue;
      const c = riceCost(e, a, b, kk);
      if (c < best.bits) best = { k: kk, bits: c };
    }
    return best;
  }

  /* Analisa um canal: escolhe a melhor ordem e partição. */
  function planSubframe(x, bps) {
    const n = x.length;
    let constant = true;
    for (let i = 1; i < n; i++) if (x[i] !== x[0]) { constant = false; break; }
    if (constant) return { type: 'const', bits: 8 + bps };
    // 1) ordem do preditor pela menor soma dos resíduos
    let order = 0, bestSum = Infinity, e = null;
    for (let o = 0; o <= Math.min(4, n - 1); o++) {
      const r = residual(x, o);
      let sum = 0;
      for (let i = o; i < n; i++) sum += Math.abs(r[i]);
      if (sum < bestSum) { bestSum = sum; order = o; e = r; }
    }
    // 2) ordem de partição Rice
    let best = null;
    for (let po = 0; po <= 4; po++) {
      if (po > 0 && n % (1 << po) !== 0) break;
      const part = n >> po;
      if (part <= order) break;
      let bits = 8 + order * bps + 6;
      const ks = [];
      for (let p = 0; p < (1 << po); p++) {
        const a = p === 0 ? order : p * part, b = (p + 1) * part;
        const r = bestRice(e, a, b);
        ks.push(r.k); bits += 4 + r.bits;
      }
      if (!best || bits < best.bits) best = { type: 'fixed', order, po, ks, e, bits };
    }
    const verbatim = 8 + n * bps;
    if (best.bits >= verbatim) return { type: 'verbatim', bits: verbatim };
    return best;
  }

  function writeSubframe(w, x, bps, plan) {
    if (plan.type === 'const') { w.bits(0, 8); w.signed(x[0], bps); return; }
    if (plan.type === 'verbatim') { w.bits(0x02, 8); for (let i = 0; i < x.length; i++) w.signed(x[i], bps); return; }
    w.bits((0x08 | plan.order) << 1, 8); // 0 + 001xxx + sem wasted bits
    for (let i = 0; i < plan.order; i++) w.signed(x[i], bps);
    w.bits(0, 2);           // Rice com parâmetro de 4 bits
    w.bits(plan.po, 4);
    const part = x.length >> plan.po;
    const e = plan.e;
    for (let p = 0; p < (1 << plan.po); p++) {
      const k = plan.ks[p];
      w.bits(k, 4);
      const a = p === 0 ? plan.order : p * part, b = (p + 1) * part;
      for (let i = a; i < b; i++) {
        const v = e[i], u = v >= 0 ? 2 * v : -2 * v - 1;
        w.unary(u >>> k);
        if (k) w.bits(u & ((1 << k) - 1), k);
      }
    }
  }

  function utf8Num(n) {
    if (n < 0x80) return [n];
    const out = [];
    let bytes = n < 0x800 ? 2 : n < 0x10000 ? 3 : n < 0x200000 ? 4 : n < 0x4000000 ? 5 : 6;
    for (let i = bytes - 1; i > 0; i--) { out.unshift(0x80 | (n & 0x3f)); n = Math.floor(n / 64); }
    out.unshift(((0xff00 >> bytes) & 0xff) | n);
    return out;
  }

  async function flac(mix, onProgress) {
    const { L, R, sr } = mix;
    const total = L.length;
    const l16 = toInt16(L, 0, total), r16 = toInt16(R, 0, total);
    const parts = [];
    // cabeçalho + STREAMINFO
    const h = new BitWriter(64);
    [0x66, 0x4c, 0x61, 0x43].forEach((b) => h.bits(b, 8)); // "fLaC"
    h.bits(1, 1); h.bits(0, 7); h.bits(34, 24);
    h.bits(BLOCK, 16); h.bits(BLOCK, 16);
    h.bits(0, 24); h.bits(0, 24);
    h.bits(sr, 20); h.bits(1, 3); h.bits(15, 5);
    h.bits(Math.floor(total / 2 ** 32) & 0xf, 4); h.bits(total % 2 ** 32, 32);
    for (let i = 0; i < 16; i++) h.bits(0, 8); // MD5 desconhecido
    parts.push(h.bytes().slice());

    let frame = 0;
    for (let start = 0; start < total; start += BLOCK, frame++) {
      const n = Math.min(BLOCK, total - start);
      const l = new Int32Array(n), r = new Int32Array(n), m = new Int32Array(n), s = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        l[i] = l16[start + i]; r[i] = r16[start + i];
        s[i] = l[i] - r[i]; m[i] = (l[i] + r[i]) >> 1;
      }
      const pl = planSubframe(l, 16), pr = planSubframe(r, 16), pm = planSubframe(m, 16), ps = planSubframe(s, 17);
      const opts = [
        { code: 1, a: [l, pl, 16], b: [r, pr, 16], bits: pl.bits + pr.bits },
        { code: 8, a: [l, pl, 16], b: [s, ps, 17], bits: pl.bits + ps.bits },
        { code: 9, a: [s, ps, 17], b: [r, pr, 16], bits: ps.bits + pr.bits },
        { code: 10, a: [m, pm, 16], b: [s, ps, 17], bits: pm.bits + ps.bits },
      ];
      opts.sort((x, y) => x.bits - y.bits);
      const ch = opts[0];
      const w = new BitWriter(Math.ceil(ch.bits / 8) + 64);
      w.bits(0x3ffe, 14); w.bits(0, 1); w.bits(0, 1);
      w.bits(7, 4);              // tamanho do bloco: 16 bits no fim do cabeçalho
      w.bits(0, 4);              // taxa: vem do STREAMINFO
      w.bits(ch.code, 4);
      w.bits(4, 3);              // 16 bits por amostra
      w.bits(0, 1);
      utf8Num(frame).forEach((b) => w.bits(b, 8));
      w.bits(n - 1, 16);
      const hdr = w.bytes();
      let c8 = 0;
      for (let i = 0; i < hdr.length; i++) c8 = CRC8[c8 ^ hdr[i]];
      w.bits(c8, 8);
      writeSubframe(w, ch.a[0], ch.a[2], ch.a[1]);
      writeSubframe(w, ch.b[0], ch.b[2], ch.b[1]);
      w.align();
      const body = w.bytes();
      let c16 = 0;
      for (let i = 0; i < body.length; i++) c16 = ((c16 << 8) & 0xffff) ^ CRC16[(c16 >> 8) ^ body[i]];
      w.bits(c16, 16);
      parts.push(w.bytes().slice());
      if (frame % 40 === 0) { if (onProgress) onProgress(start / total); await tick(); }
    }
    if (onProgress) onProgress(1);
    return new Blob(parts, { type: 'audio/flac' });
  }

  /* ================= ZIP (sem compressão) ================= */

  const CRC32 = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC32[i] = c >>> 0;
  }
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC32[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function zip(files) { // files: [{name, blob}]
    const parts = [], central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const name = new TextEncoder().encode(f.name);
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + data.length;
      await tick();
    }
    let cdSize = 0;
    central.forEach((c) => { cdSize += c.byteLength; });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [end.buffer]), { type: 'application/zip' });
  }

  /* Estimativa de tamanho do arquivo (bytes) para mostrar ao usuário. */
  function estimateSize(format, seconds, sr) {
    switch (format) {
      case 'mp3-320': return seconds * 320000 / 8;
      case 'mp3-192': return seconds * 192000 / 8;
      case 'mp3-128': return seconds * 128000 / 8;
      case 'wav16': return seconds * sr * 4;
      case 'wav24': return seconds * sr * 6;
      case 'flac': return seconds * sr * 4 * 0.45;
      case 'zip': return seconds * sr * 4 * 6;
      default: return 0;
    }
  }

  global.Formats = { wav, mp3, flac, zip, estimateSize };
})(window);

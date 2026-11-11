/* Teoria musical básica: escalas, acordes, conversões e gerador pseudoaleatório. */
(function (global) {
  'use strict';

  const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const NOTE_PT = ['Dó', 'Dó#', 'Ré', 'Mi♭', 'Mi', 'Fá', 'Fá#', 'Sol', 'Lá♭', 'Lá', 'Si♭', 'Si'];

  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
  };

  const MODE_PT = { major: 'maior', minor: 'menor', dorian: 'dórico', mixolydian: 'mixolídio' };

  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function ftom(f) { return 69 + 12 * Math.log2(f / 440); }

  function midiToName(m, pt) {
    const r = Math.round(m);
    const names = pt ? NOTE_PT : NOTE_NAMES;
    return names[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
  }

  function keyName(key, mode) {
    return NOTE_PT[((key % 12) + 12) % 12] + ' ' + (MODE_PT[mode] || mode);
  }

  /* Hash de string -> inteiro de 32 bits (cyrb53 reduzido). */
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 ^ h1) >>> 0;
  }

  /* PRNG determinístico (mulberry32) com utilitários. */
  function rng(seed) {
    let a = seed >>> 0;
    const next = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.chance = (p) => next() < p;
    next.weighted = (pairs) => {
      let total = 0;
      for (const [, w] of pairs) total += w;
      let x = next() * total;
      for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; }
      return pairs[pairs.length - 1][0];
    };
    return next;
  }

  /* Grau da escala (pode ser negativo ou > 6) -> nota MIDI. */
  function degreeToMidi(key, scale, deg, base) {
    const n = scale.length;
    const o = Math.floor(deg / n);
    const i = ((deg % n) + n) % n;
    return base + key + scale[i] + 12 * o;
  }

  /* Monta um acorde a partir do grau da escala. */
  function buildChord(key, mode, deg, opts) {
    opts = opts || {};
    const scale = SCALES[mode] || SCALES.major;
    const d = ((deg % 7) + 7) % 7;
    const pcOf = (k) => (key + scale[(d + k) % 7] + 12) % 12;
    const root = pcOf(0);
    let third = pcOf(2);
    const fifth = pcOf(4);
    let seventh = pcOf(6);
    // V maior em tonalidade menor (harmônica), soa mais "resolvido".
    if (opts.harmonicV && (mode === 'minor') && d === 4) third = (third + 1) % 12;
    if (opts.dom7) { // blues: todos os acordes com sétima menor
      third = (root + 4) % 12;
      seventh = (root + 10) % 12;
    }
    const pcs = [root, third, fifth];
    if (opts.sevenths || opts.dom7) pcs.push(seventh);
    const quality = ((third - root + 12) % 12) === 3 ? 'm' : '';
    return { deg: d, root, pcs, name: NOTE_NAMES[root] + quality + (pcs.length > 3 ? '7' : '') };
  }

  /* Escolhe a inversão do acorde mais próxima da anterior (condução de vozes). */
  function voiceChord(pcs, prev, lo, hi) {
    lo = lo || 52; hi = hi || 76;
    const candidates = [];
    for (let rot = 0; rot < pcs.length; rot++) {
      const order = pcs.slice(rot).concat(pcs.slice(0, rot));
      for (let base = lo - 12; base <= hi; base += 12) {
        const notes = [];
        let last = -Infinity;
        for (const pc of order) {
          let m = base + pc;
          while (m <= last) m += 12;
          notes.push(m);
          last = m;
        }
        if (notes[0] >= lo && notes[notes.length - 1] <= hi) candidates.push(notes);
      }
    }
    if (!candidates.length) return pcs.map((pc) => 60 + pc);
    if (!prev || !prev.length) {
      const center = (lo + hi) / 2;
      candidates.sort((a, b) => Math.abs(avg(a) - center) - Math.abs(avg(b) - center));
      return candidates[0];
    }
    const pAvg = avg(prev);
    candidates.sort((a, b) => Math.abs(avg(a) - pAvg) - Math.abs(avg(b) - pAvg));
    return candidates[0];
  }

  function avg(a) { return a.reduce((s, x) => s + x, 0) / a.length; }

  /* Nota mais próxima de `m` cuja classe pertence a `pcs`. */
  function nearestPc(m, pcs) {
    let best = m, bd = Infinity;
    for (let d = -6; d <= 6; d++) {
      const pc = (((m + d) % 12) + 12) % 12;
      if (pcs.includes(pc) && Math.abs(d) < bd) { bd = Math.abs(d); best = m + d; }
    }
    return best;
  }

  /* Detecção de tonalidade (Krumhansl-Schmuckler) a partir de notas com duração. */
  const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function detectKey(notes) {
    const hist = new Array(12).fill(0);
    for (const n of notes) hist[((Math.round(n.midi) % 12) + 12) % 12] += n.dur || 1;
    let best = { key: 0, mode: 'major', score: -Infinity };
    for (let k = 0; k < 12; k++) {
      for (const [mode, prof] of [['major', KK_MAJOR], ['minor', KK_MINOR]]) {
        const rotated = hist.map((_, i) => hist[(i + k) % 12]);
        const s = corr(rotated, prof);
        if (s > best.score) best = { key: k, mode, score: s };
      }
    }
    return best;
  }

  function corr(a, b) {
    const ma = avg(a), mb = avg(b);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < a.length; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }

  global.MT = {
    NOTE_NAMES, NOTE_PT, SCALES, MODE_PT,
    mtof, ftom, midiToName, keyName, hash, rng,
    degreeToMidi, buildChord, voiceChord, nearestPc, detectKey,
  };
})(window);

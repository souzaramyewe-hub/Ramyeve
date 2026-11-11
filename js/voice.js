/*
 * Clonagem de voz e canto sintetizado.
 *
 * Como funciona:
 * 1. O usuário canta as vogais A, E, I, O, U (gravação guiada).
 * 2. De cada vogal extraímos um trecho estável e marcamos cada ciclo da onda
 *    (marcas de pitch). Esses ciclos carregam o timbre da voz (formantes).
 * 3. Para cantar, usamos TD-PSOLA: os ciclos da voz do usuário são recolocados
 *    no ritmo da nota desejada, preservando o timbre. Consoantes são geradas
 *    com ruído filtrado e a própria voz (nasais, laterais).
 * Tudo roda no navegador; nada é enviado para servidores.
 */
(function (global) {
  'use strict';
  const SR = 44100;
  const VOWELS = ['a', 'e', 'i', 'o', 'u'];
  const SEG_SEC = 2.6;   // segundos por vogal na gravação guiada
  const LEAD_IN = 0.8;   // segundos antes da primeira vogal

  /* ================= DSP ================= */

  function makeFilter(type, freq, Q) {
    const w = 2 * Math.PI * Math.min(freq, SR * 0.45) / SR;
    const cs = Math.cos(w), sn = Math.sin(w), alpha = sn / (2 * Q);
    let b0, b1, b2;
    if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
    else { b0 = alpha; b1 = 0; b2 = -alpha; } // bandpass
    const a0 = 1 + alpha, a1 = -2 * cs, a2 = 1 - alpha;
    b0 /= a0; b1 /= a0; b2 /= a0;
    const A1 = a1 / a0, A2 = a2 / a0;
    return (x) => {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < x.length; i++) {
        const y = b0 * x[i] + b1 * x1 + b2 * x2 - A1 * y1 - A2 * y2;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
      }
      return x;
    };
  }

  function rms(x, a, b) {
    a = a || 0; b = b || x.length;
    let e = 0;
    for (let i = a; i < b; i++) e += x[i] * x[i];
    return Math.sqrt(e / Math.max(1, b - a));
  }

  /* YIN simplificado para uma janela. Retorna f0 em Hz ou 0. */
  function yinF0(x, start, W, minF, maxF) {
    const minLag = Math.floor(SR / maxF), maxLag = Math.ceil(SR / minF);
    if (start + W + maxLag >= x.length) return 0;
    const d = new Float32Array(maxLag + 1);
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0;
      for (let i = 0; i < W; i += 2) { const df = x[start + i] - x[start + i + tau]; s += df * df; }
      d[tau] = s;
    }
    let run = 0;
    for (let tau = 1; tau <= maxLag; tau++) { run += d[tau]; d[tau] = run ? d[tau] * tau / run : 1; }
    for (let t = minLag; t <= maxLag; t++) {
      if (d[t] < 0.2) {
        while (t + 1 <= maxLag && d[t + 1] < d[t]) t++;
        let better = t;
        if (t > 1 && t < maxLag) {
          const den = 2 * (2 * d[t] - d[t + 1] - d[t - 1]);
          if (den) better = t + (d[t + 1] - d[t - 1]) / den;
        }
        return SR / better;
      }
    }
    return 0;
  }

  function argmax(x, lo, hi) {
    let best = lo, bv = -Infinity;
    for (let i = Math.max(0, lo); i < Math.min(x.length, hi); i++) if (x[i] > bv) { bv = x[i]; best = i; }
    return best;
  }

  /* ================= Análise de uma vogal ================= */

  function analyzeVowel(x) {
    // procura o maior trecho com altura estável
    const hop = 1024, W = 2048;
    const f0s = [];
    for (let s = 0; s + W + 700 < x.length; s += hop) {
      f0s.push(rms(x, s, s + W) > 0.004 ? yinF0(x, s, W, 70, 900) : 0);
    }
    const voiced = f0s.filter((f) => f > 0).map((f) => 12 * Math.log2(f / 440));
    if (voiced.length < 4) throw new Error('voz não detectada');
    const med = voiced.slice().sort((a, b) => a - b)[Math.floor(voiced.length / 2)];
    let bestA = 0, bestLen = 0, curA = -1;
    for (let i = 0; i <= f0s.length; i++) {
      const ok = i < f0s.length && f0s[i] > 0 && Math.abs(12 * Math.log2(f0s[i] / 440) - med) < 1;
      if (ok && curA < 0) curA = i;
      if (!ok && curA >= 0) {
        if (i - curA > bestLen) { bestLen = i - curA; bestA = curA; }
        curA = -1;
      }
    }
    if (bestLen * hop / SR < 0.3) throw new Error('nota instável');
    let a = bestA * hop + hop, b = (bestA + bestLen) * hop;
    const maxLen = Math.floor(1.3 * SR);
    if (b - a > maxLen) { const c = (a + b) / 2; a = Math.floor(c - maxLen / 2); b = a + maxLen; }
    const seg = x.slice(a, b);
    // remove DC e normaliza
    let mean = 0; for (const v of seg) mean += v; mean /= seg.length;
    for (let i = 0; i < seg.length; i++) seg[i] -= mean;
    const g = 0.12 / Math.max(1e-4, rms(seg));
    for (let i = 0; i < seg.length; i++) seg[i] *= g;

    const f0 = 440 * Math.pow(2, med / 12);
    const marks = pitchMarks(seg, f0);
    if (marks.length < 8) throw new Error('trecho muito curto');
    return { samples: seg, marks: Int32Array.from(marks), f0 };
  }

  function pitchMarks(x, f0) {
    let P = SR / f0;
    const marks = [];
    let m = argmax(x, Math.round(P), Math.round(2 * P));
    while (m + 1.3 * P < x.length - 2) {
      marks.push(m);
      const nm = argmax(x, Math.round(m + 0.8 * P), Math.round(m + 1.2 * P));
      P = 0.7 * P + 0.3 * (nm - m);
      m = nm;
    }
    return marks;
  }

  function buildProfile(vowelSamples, meta) {
    const vowels = {};
    const errors = [];
    VOWELS.forEach((v) => {
      try { vowels[v] = analyzeVowel(vowelSamples[v]); }
      catch (e) { errors.push(v.toUpperCase() + ': ' + e.message); }
    });
    if (errors.length) {
      const err = new Error('Não consegui captar bem: ' + errors.join('; '));
      err.vowels = errors;
      throw err;
    }
    const f0s = VOWELS.map((v) => vowels[v].f0).sort((a, b) => a - b);
    const f0 = f0s[2];
    return Object.assign({ version: 1, vowels, f0, midi: 69 + 12 * Math.log2(f0 / 440), created: Date.now() }, meta || {});
  }

  /* Converte qualquer AudioBuffer para mono 44,1 kHz. */
  async function toMono44(buffer) {
    const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(buffer.duration * SR)), SR);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    return (await ctx.startRendering()).getChannelData(0);
  }

  /* Gravação guiada: fatia cada vogal pelo tempo e cria o perfil. */
  async function profileFromGuidedRecording(buffer) {
    const x = await toMono44(buffer);
    const parts = {};
    VOWELS.forEach((v, i) => {
      const a = Math.floor((LEAD_IN + i * SEG_SEC + 0.2) * SR);
      const b = Math.min(x.length, Math.floor((LEAD_IN + (i + 1) * SEG_SEC + 0.1) * SR));
      parts[v] = x.slice(Math.min(a, x.length), b);
    });
    return buildProfile(parts, { name: 'Minha voz', kind: 'clone' });
  }

  /* ================= Vozes sintéticas padrão ================= */

  const FORMANTS = {
    a: [[730, 90], [1100, 110], [2450, 160], [3300, 250], [4200, 300]],
    e: [[440, 70], [1900, 100], [2550, 150], [3400, 250], [4200, 300]],
    i: [[290, 60], [2250, 100], [2950, 150], [3600, 250], [4300, 300]],
    o: [[460, 70], [850, 90], [2500, 150], [3350, 250], [4200, 300]],
    u: [[320, 60], [750, 90], [2400, 150], [3300, 250], [4200, 300]],
  };

  function synthVowelRecording(v, f0, fScale, sec) {
    const n = Math.floor(sec * SR);
    const x = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const f = f0 * (1 + 0.004 * Math.sin(2 * Math.PI * 0.7 * i / SR)) * (1 + (Math.random() - 0.5) * 0.004);
      phase += f / SR;
      if (phase >= 1) phase -= 1;
      const oq = 0.6;
      let s = 0;
      if (phase < oq) { const t = phase / oq; s = 2 * t - 3 * t * t; } // derivada do fluxo glotal
      x[i] = s + (Math.random() - 0.5) * 0.03;
    }
    for (const [ff, bw] of FORMANTS[v]) {
      const F = ff * fScale, B = bw * fScale;
      const C = -Math.exp(-2 * Math.PI * B / SR);
      const Bc = 2 * Math.exp(-Math.PI * B / SR) * Math.cos(2 * Math.PI * F / SR);
      const A = 1 - Bc - C;
      let y1 = 0, y2 = 0;
      for (let i = 0; i < n; i++) { const y = A * x[i] + Bc * y1 + C * y2; y2 = y1; y1 = y; x[i] = y; }
    }
    return x;
  }

  const synthCache = {};
  function syntheticProfile(kind) {
    if (synthCache[kind]) return synthCache[kind];
    const fem = kind === 'fem';
    const parts = {};
    VOWELS.forEach((v) => { parts[v] = synthVowelRecording(v, fem ? 220 : 125, fem ? 1.17 : 1, 1.4); });
    synthCache[kind] = buildProfile(parts, { name: fem ? 'Voz sintética feminina' : 'Voz sintética masculina', kind });
    return synthCache[kind];
  }

  /* ================= Armazenamento (IndexedDB) ================= */

  function db() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('ramyeve-musica', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('voz');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function saveProfile(p) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction('voz', 'readwrite');
      tx.objectStore('voz').put(p, 'perfil');
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    });
  }
  async function loadProfile() {
    try {
      const d = await db();
      return await new Promise((res) => {
        const r = d.transaction('voz').objectStore('voz').get('perfil');
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => res(null);
      });
    } catch (e) { return null; }
  }
  async function deleteProfile() {
    const d = await db();
    return new Promise((res) => {
      const tx = d.transaction('voz', 'readwrite');
      tx.objectStore('voz').delete('perfil');
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
  }

  /* ================= Fonética (português) ================= */

  const VOWEL_MAP = { a: 'a', á: 'a', à: 'a', â: 'a', ã: 'a', e: 'e', é: 'e', ê: 'e', i: 'i', í: 'i', y: 'i', o: 'o', ó: 'o', ô: 'o', õ: 'o', u: 'u', ú: 'u', ü: 'u' };
  const isV = (c) => VOWEL_MAP[c] !== undefined;

  /* Divide uma sílaba escrita em ataque, núcleo e coda. */
  function parseSyllable(raw, wordInitial, wordFinal) {
    let s = (raw || '').toLowerCase().replace(/[^a-zà-ü]/g, '');
    if (!s) return null;
    // u mudo em que/qui/gue/gui
    s = s.replace(/([qg])u(?=[eéêií])/g, '$1');
    let i = 0;
    while (i < s.length && !isV(s[i])) i++;
    if (i >= s.length) return { onset: tokenize(s, wordInitial), v1: 'u', v2: null, coda: [], weak: true };
    let j = i;
    while (j < s.length && isV(s[j])) j++;
    const onsetStr = s.slice(0, i), nucleus = s.slice(i, j), codaStr = s.slice(j);
    let v1 = VOWEL_MAP[nucleus[0]];
    let v2 = nucleus.length > 1 ? VOWEL_MAP[nucleus[nucleus.length - 1]] : null;
    if (v2 === v1) v2 = null;
    const nasal = /[ãõ]/.test(nucleus) || /^[mn]$/.test(codaStr);
    // redução de vogal átona final (português do Brasil): "e" -> "i", "o" -> "u"
    if (wordFinal && !wordInitial && nucleus.length === 1) {
      if (nucleus === 'e') v1 = 'i';
      if (nucleus === 'o') v1 = 'u';
    }
    if (wordFinal && wordInitial && nucleus === 'e' && !onsetStr && !codaStr) v1 = 'i'; // "e" (conjunção)
    if (nucleus === 'ão' || nucleus === 'õe') v2 = nucleus === 'ão' ? 'u' : 'i';
    const onset = tokenize(onsetStr, wordInitial, v1);
    const coda = [];
    for (const c of codaStr) {
      if ('szx'.includes(c)) coda.push('s');
      else if (c === 'r') coda.push('h_soft');
      else if (c === 'l') v2 = v2 || 'u';
      else if (c === 'm' || c === 'n') coda.push('n_tail');
    }
    return { onset, v1, v2, coda, nasal };
  }

  function tokenize(on, wordInitial, nextVowel) {
    const out = [];
    let i = 0;
    while (i < on.length) {
      const two = on.slice(i, i + 2), c = on[i];
      if (two === 'ch') { out.push('sh'); i += 2; continue; }
      if (two === 'lh') { out.push('l'); i += 2; continue; }
      if (two === 'nh') { out.push('n'); i += 2; continue; }
      if (two === 'rr') { out.push('h'); i += 2; continue; }
      if (two === 'ss' || two === 'sc' || two === 'xc') { out.push('s'); i += 2; continue; }
      i++;
      switch (c) {
        case 'c': out.push(nextVowel === 'e' || nextVowel === 'i' ? 's' : 'k'); break;
        case 'ç': case 's': out.push('s'); break;
        case 'z': out.push('z'); break;
        case 'x': out.push('sh'); break;
        case 'j': out.push('j'); break;
        case 'g': out.push(nextVowel === 'e' || nextVowel === 'i' ? 'j' : 'g'); break;
        case 'q': case 'k': out.push('k'); break;
        case 't': out.push(nextVowel === 'i' ? 'tch' : 't'); break;
        case 'd': out.push(nextVowel === 'i' ? 'dj' : 'd'); break;
        case 'r': out.push(out.length === 0 && wordInitial ? 'h' : 'r'); break;
        case 'h': break;
        case 'w': out.push('l'); break;
        default: if ('pbfvmnl'.includes(c)) out.push(c);
      }
    }
    return out;
  }

  const CONS = {
    s: { kind: 'fric', f: 6500, q: 1.2, len: 0.09, g: 0.32 },
    z: { kind: 'fric', f: 5500, q: 1.2, len: 0.07, g: 0.2, voiced: true },
    sh: { kind: 'fric', f: 3000, q: 1.4, len: 0.09, g: 0.32 },
    j: { kind: 'fric', f: 2800, q: 1.4, len: 0.07, g: 0.2, voiced: true },
    f: { kind: 'fric', f: 4000, q: 0.6, len: 0.08, g: 0.16 },
    v: { kind: 'fric', f: 3500, q: 0.6, len: 0.06, g: 0.1, voiced: true },
    h: { kind: 'fric', f: 1400, q: 0.7, len: 0.07, g: 0.18 },
    h_soft: { kind: 'fric', f: 1400, q: 0.7, len: 0.05, g: 0.1 },
    p: { kind: 'stop', f: 900, len: 0.045, g: 0.4 },
    b: { kind: 'stop', f: 700, len: 0.04, g: 0.28, voiced: true },
    t: { kind: 'stop', f: 4000, len: 0.045, g: 0.35 },
    d: { kind: 'stop', f: 3200, len: 0.04, g: 0.26, voiced: true },
    k: { kind: 'stop', f: 2200, len: 0.05, g: 0.4 },
    g: { kind: 'stop', f: 1800, len: 0.045, g: 0.28, voiced: true },
    tch: { kind: 'affr', f: 3200, len: 0.085, g: 0.32 },
    dj: { kind: 'affr', f: 3000, len: 0.075, g: 0.24, voiced: true },
    m: { kind: 'nasal', len: 0.07 },
    n: { kind: 'nasal', len: 0.06 },
    n_tail: { kind: 'nasal', len: 0.06 },
    l: { kind: 'liquid', len: 0.045 },
    r: { kind: 'tap', len: 0.025 },
  };

  /* ================= Síntese (TD-PSOLA) ================= */

  function makeVoiceState(profile) {
    const st = {};
    VOWELS.forEach((v) => { st[v] = { idx: 1 + Math.floor(Math.random() * 5), dir: 1 }; });
    return st;
  }

  function addGrain(out, center, vw, idx, gain) {
    const m = vw.marks[idx], hl = m - vw.marks[idx - 1], hr = vw.marks[idx + 1] - m;
    const src = vw.samples;
    for (let k = -hl; k < hr; k++) {
      const oi = center + k;
      if (oi < 0 || oi >= out.length) continue;
      const w = k < 0 ? 0.5 * (1 + Math.cos(Math.PI * k / hl)) : 0.5 * (1 + Math.cos(Math.PI * k / hr));
      out[oi] += src[m + k] * w * gain;
    }
    return (hl + hr) / 2;
  }

  function advance(vw, s) {
    s.idx += s.dir;
    if (s.idx >= vw.marks.length - 2) { s.dir = -1; s.idx = vw.marks.length - 3; }
    if (s.idx <= 1) { s.dir = 1; s.idx = 2; }
  }

  /*
   * Canta uma vogal (ou transição entre duas) em `out`, de `start` por `len` amostras.
   * f0At(i) -> Hz, mixAt(i) -> 0..1 (peso da segunda vogal), ampAt(i) -> ganho.
   */
  function singVowel(out, start, len, profile, state, v1, v2, f0At, mixAt, ampAt) {
    const A = profile.vowels[v1], B = v2 ? profile.vowels[v2] : null;
    let pos = 0;
    while (pos < len) {
      const f = f0At(pos);
      const T = SR / f;
      const amp = ampAt(pos);
      const w = B ? mixAt(pos) : 0;
      const c = start + Math.round(pos);
      if (1 - w > 0.001) {
        const P = (A.marks[state[v1].idx + 1] - A.marks[state[v1].idx - 1]) / 2;
        addGrain(out, c, A, state[v1].idx, amp * (1 - w) * Math.min(2, T / P));
      }
      if (B && w > 0.001) {
        const P = (B.marks[state[v2].idx + 1] - B.marks[state[v2].idx - 1]) / 2;
        addGrain(out, c, B, state[v2].idx, amp * w * Math.min(2, T / P));
      }
      advance(A, state[v1]);
      if (B) advance(B, state[v2]);
      pos += T;
    }
  }

  function noise(len) {
    const x = new Float32Array(len);
    for (let i = 0; i < len; i++) x[i] = Math.random() * 2 - 1;
    return x;
  }

  function addInto(out, start, x, gain) {
    for (let i = 0; i < x.length; i++) {
      const o = start + i;
      if (o >= 0 && o < out.length) out[o] += x[i] * gain;
    }
  }

  /* Gera uma consoante começando em `start` com duração `len` amostras. */
  function consonant(out, start, len, c, hz, profile, state) {
    const k = CONS[c];
    if (!k || len <= 0) return;
    if (k.kind === 'fric' || k.kind === 'affr') {
      const x = makeFilter('bandpass', k.f, k.q || 1.2)(noise(len));
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const env = k.kind === 'affr' ? (t < 0.25 ? 0.3 : Math.min(1, (1 - t) * 4)) : Math.min(1, t * 6, (1 - t) * 5);
        x[i] *= env;
      }
      addInto(out, start, x, k.g * 1.6);
      if (k.voiced) hum(out, start, len, hz, profile, state, 700, 0.35);
    } else if (k.kind === 'stop') {
      if (k.voiced) hum(out, start, Math.floor(len * 0.8), hz, profile, state, 400, 0.4);
      const bl = Math.floor(0.014 * SR);
      const x = makeFilter('bandpass', k.f, 0.9)(noise(bl));
      for (let i = 0; i < bl; i++) x[i] *= Math.exp(-i / (bl / 4));
      addInto(out, start + len - bl, x, k.g * 2);
    } else if (k.kind === 'nasal') {
      hum(out, start, len, hz, profile, state, 450, 0.8);
    } else if (k.kind === 'liquid') {
      hum(out, start, len, hz, profile, state, 1600, 0.6, 'i');
    }
    // 'tap' (r fraco): apenas um pequeno corte no som
  }

  function hum(out, start, len, hz, profile, state, lp, gain, vowel) {
    const tmp = new Float32Array(len + 2000);
    singVowel(tmp, 1000, len, profile, state, vowel || 'u', null, () => hz, () => 0, (i) => Math.min(1, i / 300, (len - i) / 300));
    makeFilter('lowpass', lp, 0.7)(tmp);
    addInto(out, start - 1000, tmp, gain);
  }

  /*
   * Cria a faixa de voz cantada para a música.
   * notes: [{time, dur (s), midi, syl}]  (syl com '-' = sílaba no meio da palavra)
   */
  function renderSinging(notes, profile, totalSec) {
    const out = new Float32Array(Math.ceil(totalSec * SR));
    const state = makeVoiceState(profile);
    let prevSyl = null;
    const parsed = notes.map((n) => {
      const raw = n.syl || '';
      const wordInitial = !prevSyl || !/-$/.test(prevSyl);
      const wordFinal = !/-$/.test(raw);
      prevSyl = raw || null;
      if (!raw) return null;
      return parseSyllable(raw, wordInitial, wordFinal);
    });
    let prevMidi = null, prevEnd = -1;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      const ph = parsed[i] || { onset: n.vocalize ? ['l'] : [], v1: n.vowel || 'a', v2: null, coda: [] };
      const hz = 440 * Math.pow(2, (n.midi - 69) / 12);
      const noteStart = Math.floor(n.time * SR);
      let noteEnd = Math.floor((n.time + n.dur) * SR);
      const next = notes[i + 1];
      if (next) {
        const nextPh = parsed[i + 1];
        const pre = nextPh ? nextPh.onset.reduce((s, c) => s + (CONS[c] ? CONS[c].len : 0), 0) * 0.6 : 0;
        noteEnd = Math.min(noteEnd, Math.floor((next.time - pre) * SR) - 1);
      }
      // ataque (consoantes antes do tempo da nota)
      let onsetLen = 0;
      ph.onset.forEach((c) => { onsetLen += Math.floor((CONS[c] ? CONS[c].len : 0.03) * SR); });
      let cpos = Math.max(prevEnd + 1, noteStart - Math.floor(onsetLen * 0.6));
      for (const c of ph.onset) {
        const l = Math.floor((CONS[c] ? CONS[c].len : 0.03) * SR);
        consonant(out, cpos, l, c, hz, profile, state);
        cpos += l;
      }
      const vStart = Math.max(cpos, noteStart);
      let codaLen = 0;
      ph.coda.forEach((c) => { codaLen += Math.floor((CONS[c] ? CONS[c].len : 0.04) * SR); });
      const vLen = Math.max(Math.floor(0.06 * SR), noteEnd - vStart - codaLen);
      const legato = prevMidi != null && (vStart - prevEnd) < 0.08 * SR;
      const fromMidi = legato ? prevMidi : n.midi - 0.5;
      const glide = Math.floor((legato ? 0.06 : 0.05) * SR);
      const durSec = vLen / SR;
      const f0At = (p) => {
        const t = p / SR;
        let m = n.midi;
        if (p < glide) m = fromMidi + (n.midi - fromMidi) * (0.5 - 0.5 * Math.cos(Math.PI * p / glide));
        if (t > 0.25 && durSec > 0.4) {
          const depth = Math.min(1, (t - 0.25) / 0.3) * 0.28;
          m += depth * Math.sin(2 * Math.PI * 5.4 * t);
        }
        return 440 * Math.pow(2, (m - 69) / 12);
      };
      const att = Math.floor((ph.onset.length ? 0.012 : 0.03) * SR), rel = Math.floor(0.05 * SR);
      const ampAt = (p) => {
        let a = Math.min(1, p / att, (vLen - p) / rel + (ph.coda.length ? 0.3 : 0));
        if (durSec > 0.8) a *= 1 - 0.15 * (p / vLen);
        return Math.max(0, a) * (n.vel || 0.9);
      };
      const mixAt = (p) => {
        const t = p / vLen;
        return ph.v2 ? Math.max(0, Math.min(1, (t - 0.55) / 0.3)) : 0;
      };
      singVowel(out, vStart, vLen, profile, state, ph.v1, ph.v2, f0At, mixAt, ampAt);
      let cp = vStart + vLen;
      for (const c of ph.coda) {
        const l = Math.floor((CONS[c] ? CONS[c].len : 0.04) * SR);
        consonant(out, cp, l, c, hz, profile, state);
        cp += l;
      }
      prevMidi = n.midi;
      prevEnd = cp;
    }
    // normaliza suavemente
    let peak = 0;
    for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
    if (peak > 0) { const g = 0.7 / peak; for (let i = 0; i < out.length; i++) out[i] *= g; }
    const buf = new AudioBuffer({ numberOfChannels: 1, length: out.length, sampleRate: SR });
    buf.copyToChannel(out, 0);
    return buf;
  }

  /* Converte as notas da música em notas cantadas (no registro da voz). */
  function songToSinging(song, profile) {
    const stepDur = 60 / song.bpm / 4;
    const notes = song.parts.lead;
    if (!notes.length) return [];
    const hasLyrics = notes.some((n) => n.syl);
    const sorted = notes.map((n) => n.midi).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const shift = Math.round((profile.midi + 6 - median) / 12) * 12;
    return notes
      .filter((n) => !hasLyrics || n.syl)
      .map((n) => ({
        time: global.Synth.stepToTime(song, n.step),
        dur: n.dur * stepDur,
        midi: n.midi + shift,
        syl: n.syl,
        vel: n.vel,
        vocalize: !hasLyrics && n.step % 4 === 0,
        vowel: hasLyrics ? 'a' : (n.step % 4 === 0 ? 'a' : 'u'),
      }));
  }

  /* Demonstração curta para o usuário ouvir a voz. */
  function demo(profile) {
    const base = Math.round(profile.midi) + 2;
    const syls = ['Es-', 'ta', 'é', 'a', 'mi-', 'nha', 'voz', 'can-', 'tan-', 'do'];
    const steps = [0, 2, 4, 5, 7, 5, 4, 2, 4, 0];
    const notes = syls.map((s, i) => ({ time: 0.2 + i * 0.32, dur: i === syls.length - 1 ? 0.9 : 0.3, midi: base + steps[i], syl: s, vel: 0.9 }));
    return renderSinging(notes, profile, 4.6);
  }

  global.VoiceClone = {
    VOWELS, SEG_SEC, LEAD_IN,
    profileFromGuidedRecording, buildProfile, syntheticProfile,
    saveProfile, loadProfile, deleteProfile,
    renderSinging, songToSinging, demo, parseSyllable,
    _synthVowel: synthVowelRecording,
  };
})(window);

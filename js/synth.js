/*
 * Sintetizador: renderiza a música em um OfflineAudioContext.
 * Cada parte (bateria, baixo, harmonia, melodia, voz) vira uma faixa estéreo
 * separada ("stem"), para permitir mixagem ao vivo.
 */
(function (global) {
  'use strict';
  const { mtof } = global.MT;
  const STEMS = ['drums', 'bass', 'harmony', 'melody', 'voice'];

  /* ---------------- utilidades ---------------- */

  function noiseBuffer(ctx, sec) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function impulse(ctx, sec, decay) {
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  function distCurve(amount) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    return c;
  }

  function osc(ctx, type, freq, t, end, detune) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    o.start(t);
    o.stop(end);
    return o;
  }

  /* Envelope ADSR em um GainNode. */
  function env(ctx, t, dur, a, d, s, r, peak) {
    const g = ctx.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.setTargetAtTime(peak * s, t + a, Math.max(0.005, d / 3));
    const rel = Math.max(t + a, t + dur);
    p.cancelAndHoldAtTime ? p.cancelAndHoldAtTime(rel) : p.setValueAtTime(peak * s, rel);
    p.setTargetAtTime(0, rel, Math.max(0.005, r / 4));
    return { g, end: rel + r + 0.05 };
  }

  function vibrato(ctx, target, t, end, rate, depth, delay) {
    const lfo = osc(ctx, 'sine', rate, t, end);
    const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(depth, t + (delay || 0.25));
    lfo.connect(lg).connect(target);
  }

  /* ---------------- instrumentos melódicos ---------------- */
  // assinatura: (ctx, out, t, midi, dur, vel, shared)

  const INST = {
    piano(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const decay = 0.8 + Math.max(0, 84 - m) * 0.045;
      const e = env(ctx, t, dur, 0.004, decay, 0.0, 0.25, vel * 0.32);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(9000, f * (4 + vel * 6)), t);
      lp.frequency.setTargetAtTime(Math.max(300, f * 2), t, 0.4);
      const o1 = osc(ctx, 'triangle', f, t, e.end);
      const o2 = osc(ctx, 'sine', f * 2, t, e.end, 3);
      const o3 = osc(ctx, 'sawtooth', f, t, e.end, -4);
      const g2 = ctx.createGain(); g2.gain.value = 0.35;
      const g3 = ctx.createGain(); g3.gain.value = 0.12;
      o1.connect(lp); o2.connect(g2).connect(lp); o3.connect(g3).connect(lp);
      lp.connect(e.g).connect(out);
    },
    epiano(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.005, 1.6, 0.25, 0.3, vel * 0.3);
      const car = osc(ctx, 'sine', f, t, e.end);
      const mod = osc(ctx, 'sine', f * 1, t, e.end);
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(f * 1.6 * vel, t);
      mg.gain.setTargetAtTime(f * 0.15, t, 0.25);
      mod.connect(mg).connect(car.frequency);
      const bell = osc(ctx, 'sine', f * 4, t, t + 0.4);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.08 * vel, t);
      bg.gain.setTargetAtTime(0, t, 0.08);
      bell.connect(bg).connect(e.g);
      car.connect(e.g).connect(out);
    },
    organ(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.01, 0.1, 0.9, 0.06, vel * 0.13);
      [1, 2, 3, 4].forEach((h, i) => {
        const o = osc(ctx, 'sine', f * h, t, e.end);
        const g = ctx.createGain(); g.gain.value = [1, 0.6, 0.35, 0.25][i];
        o.connect(g).connect(e.g);
      });
      e.g.connect(out);
    },
    pad(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.5, 1, 0.8, 1.2, vel * 0.09);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.Q.value = 2;
      lp.frequency.setValueAtTime(600, t);
      lp.frequency.linearRampToValueAtTime(2200, t + Math.min(dur, 2));
      [-9, 9, 0].forEach((dt, i) => osc(ctx, i === 2 ? 'triangle' : 'sawtooth', f, t, e.end, dt).connect(lp));
      lp.connect(e.g).connect(out);
    },
    strings(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.18, 0.5, 0.85, 0.5, vel * 0.08);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = Math.min(5000, f * 6);
      [-7, 6, 0].forEach((dt) => {
        const o = osc(ctx, 'sawtooth', f, t, e.end, dt);
        vibrato(ctx, o.frequency, t, e.end, 5.2, f * 0.006, 0.3);
        o.connect(lp);
      });
      lp.connect(e.g).connect(out);
    },
    violin(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.07, 0.3, 0.8, 0.25, vel * 0.13);
      const o = osc(ctx, 'sawtooth', f, t, e.end);
      vibrato(ctx, o.frequency, t, e.end, 5.5, f * 0.012, 0.2);
      const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 2800; bp.gain.value = 6;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
      o.connect(bp).connect(lp).connect(e.g).connect(out);
    },
    cello(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.08, 0.4, 0.8, 0.3, vel * 0.22);
      const o = osc(ctx, 'sawtooth', f, t, e.end);
      vibrato(ctx, o.frequency, t, e.end, 5, f * 0.008, 0.3);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
      o.connect(lp).connect(e.g).connect(out);
    },
    flute(ctx, out, t, m, dur, vel, sh) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.05, 0.2, 0.85, 0.15, vel * 0.22);
      const o = osc(ctx, 'sine', f, t, e.end);
      const o2 = osc(ctx, 'triangle', f * 2, t, e.end);
      const g2 = ctx.createGain(); g2.gain.value = 0.12;
      vibrato(ctx, o.frequency, t, e.end, 5, f * 0.008, 0.3);
      const n = ctx.createBufferSource(); n.buffer = sh.noise; n.start(t); n.stop(e.end);
      const nb = ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = f * 2; nb.Q.value = 3;
      const ng = ctx.createGain(); ng.gain.value = 0.12;
      n.connect(nb).connect(ng).connect(e.g);
      o.connect(e.g); o2.connect(g2).connect(e.g);
      e.g.connect(out);
    },
    sax(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.03, 0.3, 0.75, 0.12, vel * 0.16);
      const o = osc(ctx, 'sawtooth', f, t, e.end);
      vibrato(ctx, o.frequency, t, e.end, 5.5, f * 0.01, 0.35);
      const f1 = ctx.createBiquadFilter(); f1.type = 'lowpass'; f1.Q.value = 4;
      f1.frequency.setValueAtTime(f * 2, t);
      f1.frequency.linearRampToValueAtTime(Math.min(4000, f * 5 * vel + 400), t + 0.06);
      f1.frequency.setTargetAtTime(f * 3, t + 0.06, 0.3);
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1200; pk.gain.value = 5;
      o.connect(f1).connect(pk).connect(e.g).connect(out);
    },
    melodica(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.02, 0.2, 0.8, 0.08, vel * 0.11);
      const o = osc(ctx, 'square', f, t, e.end);
      const o2 = osc(ctx, 'sawtooth', f, t, e.end, 8);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
      o.connect(lp); o2.connect(lp);
      lp.connect(e.g).connect(out);
    },
    accordion(ctx, out, t, m, dur, vel) {
      INST.accordionLead(ctx, out, t, m, dur, vel * 0.95);
    },
    accordionLead(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.02, 0.15, 0.85, 0.08, vel * 0.1);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.6;
      [-12, 0, 13].forEach((dt, i) => osc(ctx, i === 1 ? 'square' : 'sawtooth', f, t, e.end, dt).connect(bp));
      const trem = ctx.createGain(); trem.gain.value = 1;
      vibrato(ctx, trem.gain, t, e.end, 6, 0.15, 0.1);
      bp.connect(trem).connect(e.g).connect(out);
    },
    synthLead(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.01, 0.25, 0.7, 0.15, vel * 0.1);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
      lp.frequency.setValueAtTime(f * 8, t);
      lp.frequency.setTargetAtTime(f * 3, t, 0.15);
      const o1 = osc(ctx, 'sawtooth', f, t, e.end, -6);
      const o2 = osc(ctx, 'square', f, t, e.end, 6);
      vibrato(ctx, o1.frequency, t, e.end, 5.5, f * 0.006, 0.3);
      o1.connect(lp); o2.connect(lp);
      lp.connect(e.g).connect(out);
    },
    pluck(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, Math.min(dur, 0.3), 0.003, 0.25, 0.1, 0.15, vel * 0.16);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
      lp.frequency.setValueAtTime(f * 10, t);
      lp.frequency.setTargetAtTime(f * 1.5, t, 0.06);
      osc(ctx, 'sawtooth', f, t, e.end, -5).connect(lp);
      osc(ctx, 'sawtooth', f, t, e.end, 5).connect(lp);
      lp.connect(e.g).connect(out);
    },
    bell(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.002, 1.5, 0, 0.6, vel * 0.18);
      const car = osc(ctx, 'sine', f, t, e.end);
      const mod = osc(ctx, 'sine', f * 3.5, t, e.end);
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(f * 2, t);
      mg.gain.setTargetAtTime(0, t, 0.4);
      mod.connect(mg).connect(car.frequency);
      car.connect(e.g).connect(out);
    },
    /* violões / guitarras: corda pinçada simulada */
    nylon(ctx, out, t, m, dur, vel) { pluckString(ctx, out, t, m, dur, vel, 1800, 0.9, 'triangle'); },
    steelGuitar(ctx, out, t, m, dur, vel) { pluckString(ctx, out, t, m, dur, vel, 4200, 0.8, 'sawtooth'); },
    cavaco(ctx, out, t, m, dur, vel) { pluckString(ctx, out, t + 0.0, m + 12, Math.min(dur, 0.25), vel * 0.9, 5000, 0.25, 'sawtooth'); },
    distGuitar(ctx, out, t, m, dur, vel, sh) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.004, 0.4, 0.75, 0.08, vel * 0.075);
      const pre = ctx.createGain(); pre.gain.value = 1;
      osc(ctx, 'sawtooth', f, t, e.end, -7).connect(pre);
      osc(ctx, 'sawtooth', f, t, e.end, 7).connect(pre);
      const ws = ctx.createWaveShaper(); ws.curve = sh.dist;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
      pre.connect(ws).connect(lp).connect(hp).connect(e.g).connect(out);
    },
    leadGuitar(ctx, out, t, m, dur, vel, sh) {
      const f = mtof(m);
      const e = env(ctx, t, dur, 0.005, 0.5, 0.7, 0.15, vel * 0.07);
      const o = osc(ctx, 'sawtooth', f, t, e.end);
      vibrato(ctx, o.frequency, t, e.end, 5.8, f * 0.012, 0.35);
      const ws = ctx.createWaveShaper(); ws.curve = sh.dist;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
      const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 900; pk.gain.value = 6;
      o.connect(ws).connect(pk).connect(lp).connect(e.g).connect(out);
    },
    /* baixos */
    synthBass(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur * 0.95, 0.005, 0.3, 0.7, 0.06, vel * 0.32);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
      lp.frequency.setValueAtTime(f * 6, t);
      lp.frequency.setTargetAtTime(f * 2, t, 0.08);
      osc(ctx, 'sawtooth', f, t, e.end).connect(lp);
      osc(ctx, 'sine', f, t, e.end).connect(lp);
      lp.connect(e.g).connect(out);
    },
    pickBass(ctx, out, t, m, dur, vel, sh) {
      const f = mtof(m);
      const e = env(ctx, t, dur * 0.9, 0.003, 0.3, 0.6, 0.05, vel * 0.3);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const ws = ctx.createWaveShaper(); ws.curve = sh.softDist;
      osc(ctx, 'sawtooth', f, t, e.end).connect(ws);
      osc(ctx, 'square', f / 2, t, e.end).connect(lp);
      ws.connect(lp).connect(e.g).connect(out);
    },
    acousticBass(ctx, out, t, m, dur, vel) {
      const f = mtof(m);
      const e = env(ctx, t, dur * 0.9, 0.006, 0.6, 0.35, 0.1, vel * 0.5);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(f * 5, t);
      lp.frequency.setTargetAtTime(f * 1.5, t, 0.1);
      osc(ctx, 'triangle', f, t, e.end).connect(lp);
      osc(ctx, 'sine', f * 2, t, e.end).connect(lp);
      lp.connect(e.g).connect(out);
    },
    bass808(ctx, out, t, m, dur, vel, sh) {
      const f = mtof(m);
      const e = env(ctx, t, dur * 0.95, 0.003, 1.2, 0.6, 0.12, vel * 0.6);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.9, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      o.start(t); o.stop(e.end);
      const ws = ctx.createWaveShaper(); ws.curve = sh.softDist;
      o.connect(ws).connect(e.g).connect(out);
    },
  };

  function pluckString(ctx, out, t, m, dur, vel, bright, decay, type) {
    const f = mtof(m);
    const e = env(ctx, t, dur, 0.002, decay, 0.15, 0.15, vel * 0.18);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(Math.min(bright, f * 12), t);
    lp.frequency.setTargetAtTime(f * 1.2, t, decay / 4);
    osc(ctx, type, f, t, e.end).connect(lp);
    osc(ctx, 'sine', f * 2, t, e.end, 4).connect(lp);
    lp.connect(e.g).connect(out);
  }

  /* ---------------- bateria ---------------- */

  function noiseHit(ctx, out, sh, t, type, freq, q, decay, gain) {
    const n = ctx.createBufferSource(); n.buffer = sh.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    n.connect(f).connect(g).connect(out);
    n.start(t, Math.random() * 0.5); n.stop(t + decay + 0.02);
  }

  function toneHit(ctx, out, t, f0, f1, sweep, decay, gain, type) {
    const o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + sweep);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + decay + 0.02);
  }

  /* prato metálico estilo 808: seis osciladores quadrados em razões inarmônicas */
  const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];
  function metal(ctx, out, t, decay, gain, hp) {
    const sum = ctx.createGain(); sum.gain.value = 0.5;
    for (const f of METAL) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f * 1.7; o.connect(sum); o.start(t); o.stop(t + decay + 0.05); }
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.8;
    const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp || 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    sum.connect(bp).connect(h).connect(g).connect(out);
  }

  const DRUM = {
    kick(ctx, out, t, v, sh, style) {
      if (style.bass === '808') toneHit(ctx, out, t, 160, 48, 0.05, 0.35, v * 0.95);
      else {
        toneHit(ctx, out, t, 170, 50, 0.07, 0.42, v * 0.95);
        toneHit(ctx, out, t, 60, 52, 0.2, 0.25, v * 0.2); // corpo
      }
      toneHit(ctx, out, t, 2200, 900, 0.008, 0.012, v * 0.18, 'triangle'); // ataque do batedor
      noiseHit(ctx, out, sh, t, 'highpass', 3000, 0.7, 0.01, v * 0.18);
    },
    snare(ctx, out, t, v, sh) {
      toneHit(ctx, out, t, 330, 190, 0.04, 0.09, v * 0.3, 'triangle');
      toneHit(ctx, out, t, 185, 160, 0.03, 0.12, v * 0.28);
      noiseHit(ctx, out, sh, t, 'bandpass', 2400, 0.6, 0.22, v * 0.42);  // esteira
      noiseHit(ctx, out, sh, t, 'highpass', 6000, 0.7, 0.08, v * 0.2);   // brilho
    },
    clap(ctx, out, t, v, sh) {
      [0, 0.009, 0.019, 0.028].forEach((d) => noiseHit(ctx, out, sh, t + d, 'bandpass', 1300, 1.4, 0.025, v * 0.45));
      noiseHit(ctx, out, sh, t + 0.03, 'bandpass', 1200, 1, 0.22, v * 0.38);
    },
    hat(ctx, out, t, v) { metal(ctx, out, t, 0.05 + v * 0.02, v * 0.32); },
    ohat(ctx, out, t, v) { metal(ctx, out, t, 0.32, v * 0.26); },
    ride(ctx, out, t, v, sh) {
      metal(ctx, out, t, 0.7, v * 0.12, 4000);
      toneHit(ctx, out, t, 3200, 3150, 0.3, 0.45, v * 0.035, 'square');
      noiseHit(ctx, out, sh, t, 'bandpass', 7000, 2, 0.4, v * 0.05);
    },
    crash(ctx, out, t, v, sh) {
      metal(ctx, out, t, 1.6, v * 0.16, 3500);
      noiseHit(ctx, out, sh, t, 'highpass', 4500, 0.5, 1.8, v * 0.2);
    },
    rim(ctx, out, t, v) { toneHit(ctx, out, t, 1700, 1500, 0.02, 0.04, v * 0.3, 'square'); },
    shaker(ctx, out, t, v, sh) { noiseHit(ctx, out, sh, t, 'bandpass', 8000, 1.2, 0.06, v * 0.4); },
    perc(ctx, out, t, v, sh, style) {
      if (style.id === 'forro') { // triângulo
        toneHit(ctx, out, t, 4200, 4200, 0.1, v > 0.6 ? 0.35 : 0.08, v * 0.06, 'sine');
        toneHit(ctx, out, t, 6100, 6100, 0.1, v > 0.6 ? 0.3 : 0.06, v * 0.035, 'sine');
      } else if (style.id === 'funkbr') { // atabaque/tom grave
        toneHit(ctx, out, t, 220, 110, 0.08, 0.2, v * 0.45);
      } else { // cowbell / percussão metálica
        toneHit(ctx, out, t, 800, 800, 0.1, 0.12, v * 0.08, 'square');
        toneHit(ctx, out, t, 540, 540, 0.1, 0.12, v * 0.08, 'square');
      }
    },
    tom(ctx, out, t, v) { toneHit(ctx, out, t, 180, 90, 0.15, 0.3, v * 0.6); },
  };

  /* ---------------- renderização ---------------- */

  function stepToTime(song, step) {
    const stepDur = 60 / song.bpm / 4;
    let t = step * stepDur;
    const s = song.swing || 0;
    if (s) {
      const whole = Math.floor(step + 1e-6);
      const frac = step - whole;
      if (song.swingUnit === 8) {
        if (whole % 4 === 2 && frac < 1e-6) t += s * 2 * stepDur;
      } else if (whole % 2 === 1 && frac < 1e-6) t += s * stepDur;
    }
    return t;
  }

  const DRUM_PANS = { hat: 0.25, ohat: 0.25, shaker: -0.3, rim: -0.2, perc: 0.35, ride: 0.3, crash: -0.25 };
  const REVERB = { drums: 0.08, bass: 0, harmony: 0.25, melody: 0.3, voice: 0.18 };

  /* Cria os barramentos (um por stem) dentro de um contexto offline. */
  function buildBuses(ctx, song, shared) {
    ctx.destination.channelCount = STEMS.length * 2;
    ctx.destination.channelCountMode = 'explicit';
    ctx.destination.channelInterpretation = 'discrete';
    const merger = ctx.createChannelMerger(STEMS.length * 2);
    merger.connect(ctx.destination);
    const buses = {};
    const ambient = song.style.id === 'ambient' ? 2.2 : 1;
    STEMS.forEach((name, i) => {
      const input = ctx.createGain();
      const sum = ctx.createGain();
      let chainOut = input;
      // EQ de mixagem: cada parte no seu espaço de frequência
      const eq = (type, f, gain, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (gain != null) b.gain.value = gain; if (q) b.Q.value = q; chainOut.connect(b); chainOut = b; };
      if (name === 'bass') { eq('highpass', 32, null, 0.7); eq('peaking', 250, -3, 1); }
      if (name === 'drums') { eq('highpass', 28, null, 0.7); eq('peaking', 300, -3, 0.9); eq('highshelf', 6000, 3); }
      if (name === 'harmony') { eq('highpass', 140, null, 0.7); eq('peaking', 400, -2, 1); eq('highshelf', 4500, 4); }
      if (name === 'melody') { eq('highpass', 180, null, 0.7); eq('highshelf', 4500, 3); }
      if (song.style.lofi && name !== 'voice') {
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3800;
        chainOut.connect(lp); chainOut = lp;
      }
      chainOut.connect(sum);
      const amt = REVERB[name] * ambient;
      if (amt > 0) {
        const send = ctx.createGain(); send.gain.value = amt;
        const verb = ctx.createConvolver(); verb.buffer = shared.ir;
        chainOut.connect(send).connect(verb).connect(sum);
      }
      const st = ctx.createGain(); st.channelCount = 2; st.channelCountMode = 'explicit';
      const split = ctx.createChannelSplitter(2);
      sum.connect(st).connect(split);
      split.connect(merger, 0, i * 2);
      split.connect(merger, 1, i * 2 + 1);
      buses[name] = input;
    });
    const outs = {};
    return {
      sh: shared,
      out(key, bus, gain, pan) {
        if (outs[key]) return outs[key];
        let node = buses[bus];
        if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(node); node = p; }
        if (gain != null && gain !== 1) { const g = ctx.createGain(); g.gain.value = gain; g.connect(node); node = g; }
        outs[key] = node;
        return node;
      },
      buses,
    };
  }

  /* Lista todos os eventos sonoros com tempo absoluto. */
  const LAID_BACK = { lofi: 0.012, trap: 0.006, reggae: 0.01, blues: 0.008, jazz: 0.006, gospel: 0.008, balada: 0.006, bossa: 0.004 };

  function collectEvents(song) {
    const stepDur = 60 / song.bpm / 4;
    const ev = [];
    for (const d of song.parts.drums) {
      const fn = DRUM[d.lane];
      if (!fn) continue;
      // Groove humano: caixa um pouco atrás do tempo nos estilos com balanço,
      // pratos com dinâmica variada (mais fortes nos tempos, mais leves nos contratempos).
      const laid = LAID_BACK[song.style.id] || 0;
      let off = (Math.random() - 0.5) * 0.006;
      if (d.lane === 'snare' || d.lane === 'clap') off += laid;
      if (d.lane === 'hat' || d.lane === 'shaker') off += (Math.random() - 0.5) * 0.004;
      const t = Math.max(0, stepToTime(song, d.step) + off);
      let vel = d.vel;
      if (d.lane === 'hat' || d.lane === 'shaker' || d.lane === 'ride') {
        const pos = Math.round(d.step) % 4;
        vel *= pos === 0 ? 1 : pos === 2 ? 0.78 : 0.62;
        vel *= 0.8 + Math.random() * 0.2;
      } else vel *= 0.9 + Math.random() * 0.1;
      ev.push({ t, end: t + (d.lane === 'crash' ? 1.7 : 0.6), play: (ctx, B, tt) => fn(ctx, B.out('d_' + d.lane, 'drums', 1, DRUM_PANS[d.lane] || 0), tt, vel, B.sh, song.style) });
    }
    const part = (notes, instName, bus, gain, pan, key) => {
      if (!notes || !instName) return;
      const inst = INST[instName] || INST.piano;
      for (const n of notes) {
        const t = stepToTime(song, n.step);
        const dur = Math.max(0.05, n.dur * stepDur * 0.98);
        ev.push({ t, end: t + dur + 1.3, play: (ctx, B, tt) => inst(ctx, B.out(key, bus, gain, pan), tt, n.midi, dur, n.vel, B.sh) });
      }
    };
    part(song.parts.bass, song.instruments.bass, 'bass', 1, 0, 'bass');
    part(song.parts.chords, song.instruments.chords, 'harmony', 1, -0.15, 'chords');
    part(song.parts.pad, song.instruments.pad, 'harmony', 0.9, 0.2, 'pad');
    part(song.parts.lead, song.instruments.lead, 'melody', 1, 0.05, 'lead');
    part(song.parts.lead2, song.instruments.lead2, 'melody', 0.7, -0.1, 'lead2');
    ev.sort((a, b) => a.t - b.t);
    return ev;
  }

  async function pool(tasks, limit) {
    const results = new Array(tasks.length);
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) { const i = next++; results[i] = await tasks[i](); }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    return results;
  }

  /*
   * Renderiza a música. Retorna { stems: {drums: AudioBuffer, ...}, duration }.
   * A renderização é feita em blocos curtos (só com as notas de cada trecho),
   * o que é muito mais rápido do que um único contexto com milhares de nós.
   * opts.voiceBuffer: AudioBuffer da voz original (opcional).
   * opts.onProgress(fração): callback de progresso.
   */
  async function render(song, opts) {
    opts = opts || {};
    const stepDur = 60 / song.bpm / 4;
    const reverbSec = song.style.id === 'ambient' || song.style.id === 'classica' ? 3.5 : 2.2;
    const duration = song.totalBars * 16 * stepDur + reverbSec + 0.5;
    // Músicas longas usam taxa de amostragem menor para caber na memória.
    const SR = duration <= 240 ? 44100 : duration <= 480 ? 32000 : 22050;
    const total = Math.ceil(duration * SR);
    const tmp = new OfflineAudioContext(1, 1, SR);
    const shared = {
      noise: noiseBuffer(tmp, 2),
      ir: impulse(tmp, reverbSec, 3),
      dist: distCurve(6),
      softDist: distCurve(1.6),
    };
    const stems = {};
    const out = [];
    STEMS.forEach((name) => {
      stems[name] = new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate: SR });
      out.push(stems[name].getChannelData(0), stems[name].getChannelData(1));
    });
    const addInto = (buf, offsetSamples) => {
      for (let c = 0; c < out.length; c++) {
        const src = buf.getChannelData(c), dst = out[c];
        const n = Math.min(src.length, total - offsetSamples);
        for (let i = 0; i < n; i++) dst[offsetSamples + i] += src[i];
      }
    };

    // Blocos de ~4 s com as notas de cada trecho
    const events = collectEvents(song);
    const CHUNK = 4;
    const chunks = [];
    for (let c0 = 0; c0 < duration; c0 += CHUNK) {
      const list = events.filter((e) => e.t >= c0 && e.t < c0 + CHUNK);
      if (list.length) chunks.push({ c0, list });
    }

    // Fontes longas (voz original, voz cantada, chiado de vinil), também em blocos
    const longSources = [];
    if (opts.voiceBuffer && song.voiceStartSec != null) {
      longSources.push({ buffer: opts.voiceBuffer, when: song.voiceStartSec - song.voiceOffsetSec, gain: 1.4, bus: 'voice', comp: true });
    }
    if (opts.vocalBuffer) longSources.push({ buffer: opts.vocalBuffer, when: 0, gain: 0.9, bus: 'voice', comp: true, studio: true });
    const LCHUNK = 8;
    const longChunks = [];
    if (longSources.length || song.style.lofi) {
      for (let c0 = 0; c0 < duration; c0 += LCHUNK) longChunks.push(c0);
    }

    const totalTasks = chunks.length + longChunks.length;
    let done = 0;
    const progress = () => { done++; if (opts.onProgress) opts.onProgress(done / (totalTasks + 1)); };

    const tasks = chunks.map((ch) => async () => {
      const maxEnd = ch.list.reduce((m, e) => Math.max(m, e.end), 0);
      const len = Math.min(total - Math.floor(ch.c0 * SR), Math.ceil((maxEnd - ch.c0 + reverbSec) * SR));
      const ctx = new OfflineAudioContext(STEMS.length * 2, Math.max(128, len), SR);
      const B = buildBuses(ctx, song, shared);
      for (const e of ch.list) e.play(ctx, B, e.t - ch.c0);
      addInto(await ctx.startRendering(), Math.floor(ch.c0 * SR));
      progress();
    });

    longChunks.forEach((c0) => tasks.push(async () => {
      const c1 = Math.min(duration, c0 + LCHUNK);
      const len = Math.min(total - Math.floor(c0 * SR), Math.ceil((c1 - c0 + reverbSec) * SR));
      const ctx = new OfflineAudioContext(STEMS.length * 2, Math.max(128, len), SR);
      const B = buildBuses(ctx, song, shared);
      if (song.style.lofi) {
        const n = ctx.createBufferSource(); n.buffer = shared.noise; n.loop = true;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
        const g = ctx.createGain(); g.gain.value = 0.012;
        n.connect(hp).connect(g).connect(B.buses.drums);
        n.start(0); n.stop(c1 - c0);
      }
      for (const ls of longSources) {
        // cadeia: corte de graves, brilho, compressor; voz "de estúdio" ganha dobra e eco curto
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = ls.studio ? 110 : 90;
        let node = hp;
        if (ls.studio) {
          const mud = ctx.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 300; mud.gain.value = -3; mud.Q.value = 1;
          const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.gain.value = 4; pres.Q.value = 0.8;
          const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 9000; air.gain.value = 3;
          node = node.connect(mud).connect(pres).connect(air);
        }
        if (ls.comp) {
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -24; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.15;
          node = node.connect(comp);
        }
        const g = ctx.createGain(); g.gain.value = ls.gain;
        node.connect(g).connect(B.buses[ls.bus]);
        if (ls.studio) {
          const dl = ctx.createDelay(1); dl.delayTime.value = 0.13;
          const dg = ctx.createGain(); dg.gain.value = 0.12;
          g.connect(dl).connect(dg).connect(B.buses[ls.bus]);
        }
        const variants = [{ delay: 0, rate: 1, pan: 0, gain: 1 }];
        if (ls.studio) variants.push({ delay: 0.017, rate: 1.0025, pan: -0.45, gain: 0.3 }, { delay: 0.026, rate: 0.9975, pan: 0.45, gain: 0.3 });
        for (const vr of variants) {
          const startIn = ls.when + vr.delay - c0;            // início relativo ao bloco
          const srcOffset = Math.max(0, -startIn) * vr.rate;  // quanto da fonte já tocou
          if (srcOffset >= ls.buffer.duration || startIn >= c1 - c0) continue;
          const src = ctx.createBufferSource();
          src.buffer = ls.buffer;
          src.playbackRate.value = vr.rate;
          let dest = hp;
          if (vr.gain !== 1 || vr.pan) {
            const vg = ctx.createGain(); vg.gain.value = vr.gain;
            const pn = ctx.createStereoPanner(); pn.pan.value = vr.pan;
            vg.connect(pn).connect(hp); // as cópias passam pelo mesmo tratamento
            dest = vg;
          }
          src.connect(dest);
          src.start(Math.max(0, startIn), srcOffset, Math.max(0.001, ((c1 - c0) - Math.max(0, startIn)) * vr.rate));
        }
      }
      addInto(await ctx.startRendering(), Math.floor(c0 * SR));
      progress();
    }));

    const cores = (navigator.hardwareConcurrency || 4);
    await pool(tasks, Math.max(2, Math.min(4, cores)));
    if (opts.onProgress) opts.onProgress(1);
    balanceStems(stems, !!opts.vocalBuffer);
    return { stems, duration, stepDur, sampleRate: SR };
  }

  /*
   * Equilíbrio automático: mede o volume de cada parte (só onde ela toca) e
   * ajusta para uma mixagem de referência. Sem isso, o baixo e o bumbo
   * encobriam a harmonia e a melodia.
   */
  const TARGET_DB = { drums: -19, bass: -21, harmony: -21, melody: -21, voice: -16 };
  function balanceStems(stems, hasVocal) {
    for (const name of STEMS) {
      const b = stems[name];
      const L = b.getChannelData(0), R = b.getChannelData(1);
      let e = 0, n = 0;
      for (let i = 0; i < L.length; i += 4) {
        const v = (Math.abs(L[i]) + Math.abs(R[i])) / 2;
        if (v > 1e-3) { e += v * v; n++; }
      }
      if (!n) continue;
      const rmsDb = 10 * Math.log10(e / n);
      let target = TARGET_DB[name];
      if (name === 'melody' && hasVocal) target = -25; // com voz, o instrumento da melodia só acompanha
      const g = Math.min(8, Math.pow(10, (target - rmsDb) / 20));
      for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
    }
  }

  global.Synth = { render, STEMS, stepToTime, INSTRUMENT_NAMES: Object.keys(INST) };
})(window);

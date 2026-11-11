/* Detecção de notas cantadas (algoritmo YIN) e segmentação em notas. */
(function (global) {
  'use strict';
  const ANALYSIS_RATE = 16000;

  /* Converte qualquer áudio para mono 16 kHz. */
  async function toAnalysisBuffer(audioBuffer) {
    const len = Math.ceil(audioBuffer.duration * ANALYSIS_RATE);
    const ctx = new OfflineAudioContext(1, Math.max(1, len), ANALYSIS_RATE);
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    // filtro passa-baixa antes de reduzir a taxa
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3000;
    src.connect(lp).connect(ctx.destination);
    src.start();
    const out = await ctx.startRendering();
    return out.getChannelData(0);
  }

  function yin(buf, start, W, minLag, maxLag, threshold) {
    const d = new Float32Array(maxLag + 1);
    for (let tau = 1; tau <= maxLag; tau++) {
      let sum = 0;
      for (let i = 0; i < W; i++) {
        const diff = buf[start + i] - buf[start + i + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }
    // diferença média cumulativa normalizada
    let running = 0;
    d[0] = 1;
    for (let tau = 1; tau <= maxLag; tau++) {
      running += d[tau];
      d[tau] = running ? d[tau] * tau / running : 1;
    }
    let tau = -1;
    for (let t = minLag; t <= maxLag; t++) {
      if (d[t] < threshold) {
        while (t + 1 <= maxLag && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return { freq: 0, conf: 0 };
    // interpolação parabólica
    let better = tau;
    if (tau > 1 && tau < maxLag) {
      const s0 = d[tau - 1], s1 = d[tau], s2 = d[tau + 1];
      const denom = 2 * (2 * s1 - s2 - s0);
      if (denom) better = tau + (s2 - s0) / denom;
    }
    return { freq: ANALYSIS_RATE / better, conf: 1 - d[tau] };
  }

  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  /*
   * Analisa o áudio e devolve { notes:[{start,dur,midi}], frames:[{t,midi,rms}] }.
   * midi = 0 em quadros sem voz.
   */
  async function analyze(audioBuffer, onProgress) {
    const data = await toAnalysisBuffer(audioBuffer);
    const W = 1024, hop = 256;
    const minF = 70, maxF = 1000;
    const minLag = Math.floor(ANALYSIS_RATE / maxF), maxLag = Math.ceil(ANALYSIS_RATE / minF);
    const frames = [];
    let maxRms = 0;
    const nFrames = Math.max(0, Math.floor((data.length - W - maxLag) / hop));
    for (let f = 0; f < nFrames; f++) {
      const start = f * hop;
      let e = 0;
      for (let i = 0; i < W; i++) e += data[start + i] * data[start + i];
      const rms = Math.sqrt(e / W);
      frames.push({ t: (start + W / 2) / ANALYSIS_RATE, rms, midi: 0 });
      if (rms > maxRms) maxRms = rms;
    }
    const gate = Math.max(0.01, maxRms * 0.12);
    for (let f = 0; f < frames.length; f++) {
      if (frames[f].rms < gate) continue;
      const r = yin(data, f * hop, W, minLag, maxLag, 0.15);
      if (r.freq > 0 && r.conf > 0.75) frames[f].midi = global.MT.ftom(r.freq);
      if (onProgress && f % 200 === 0) { onProgress(f / frames.length); await new Promise((res) => setTimeout(res, 0)); }
    }
    // filtro de mediana para remover erros de oitava pontuais
    const smooth = frames.map((fr, i) => {
      if (!fr.midi) return 0;
      const win = [];
      for (let k = -2; k <= 2; k++) { const x = frames[i + k]; if (x && x.midi) win.push(x.midi); }
      return win.length >= 3 ? median(win) : fr.midi;
    });
    smooth.forEach((m, i) => { frames[i].midi = m; });

    // Segmentação em notas
    const notes = [];
    let cur = null;
    const hopSec = hop / ANALYSIS_RATE;
    const flush = () => {
      if (cur && cur.pitches.length * hopSec >= 0.08) {
        notes.push({ start: cur.start, dur: cur.pitches.length * hopSec, midi: median(cur.pitches) });
      }
      cur = null;
    };
    let pendingChange = 0;
    for (let i = 0; i < frames.length; i++) {
      const fr = frames[i];
      if (!fr.midi) { flush(); pendingChange = 0; continue; }
      if (!cur) { cur = { start: fr.t, pitches: [fr.midi] }; continue; }
      const center = median(cur.pitches.slice(-8));
      if (Math.abs(fr.midi - center) > 0.8) {
        pendingChange++;
        if (pendingChange >= 3) { // mudança sustentada: nova nota
          const tail = cur.pitches.splice(cur.pitches.length - (pendingChange - 1));
          flush();
          cur = { start: fr.t - tail.length * hopSec, pitches: tail.concat([fr.midi]) };
          pendingChange = 0;
        } else cur.pitches.push(fr.midi);
      } else {
        pendingChange = 0;
        cur.pitches.push(fr.midi);
      }
      // ataque de nova sílaba (energia sobe bruscamente)
      const prev = frames[i - 3];
      if (prev && prev.rms > 0 && fr.rms > prev.rms * 2.2 && cur.pitches.length > 6) {
        const p = cur.pitches.pop();
        flush();
        cur = { start: fr.t, pitches: [p] };
      }
    }
    flush();
    // junta notas muito próximas com a mesma altura
    const merged = [];
    for (const n of notes) {
      const last = merged[merged.length - 1];
      if (last && Math.round(last.midi) === Math.round(n.midi) && n.start - (last.start + last.dur) < 0.03) {
        last.dur = n.start + n.dur - last.start;
      } else merged.push(Object.assign({}, n));
    }
    if (onProgress) onProgress(1);
    return { notes: merged, frames, duration: audioBuffer.duration };
  }

  global.Pitch = { analyze };
})(window);

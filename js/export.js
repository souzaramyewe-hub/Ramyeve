/* Exportação: mixagem dos stems em WAV e partitura em MIDI. */
(function (global) {
  'use strict';

  /* Soma os stems com os volumes do mixer e aplica um limitador suave. */
  function mixStems(stems, gains) {
    const names = Object.keys(stems);
    const first = stems[names[0]];
    const len = first.length, sr = first.sampleRate;
    const L = new Float32Array(len), R = new Float32Array(len);
    for (const n of names) {
      const g = gains[n] == null ? 1 : gains[n];
      if (!g) continue;
      const l = stems[n].getChannelData(0), r = stems[n].getChannelData(1);
      for (let i = 0; i < len; i++) { L[i] += l[i] * g; R[i] += r[i] * g; }
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const norm = peak > 0 ? 0.95 / Math.max(peak, 0.6) : 1;
    for (let i = 0; i < len; i++) {
      L[i] = Math.tanh(L[i] * norm * 1.1) * 0.92;
      R[i] = Math.tanh(R[i] * norm * 1.1) * 0.92;
    }
    return { L, R, sr };
  }

  function toWav(mix) {
    const { L, R, sr } = mix;
    const len = L.length;
    const buf = new ArrayBuffer(44 + len * 4);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len * 4, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, len * 4, true);
    let o = 44;
    for (let i = 0; i < len; i++) {
      v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 0x7fff, true);
      v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 0x7fff, true);
      o += 4;
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  /* ---------------- MIDI ---------------- */

  const GM_PROGRAM = {
    piano: 0, epiano: 4, organ: 16, nylon: 24, steelGuitar: 25, cavaco: 24, distGuitar: 30, leadGuitar: 29,
    acousticBass: 32, pickBass: 34, synthBass: 38, bass808: 38, violin: 40, cello: 42, strings: 48,
    sax: 65, flute: 73, melodica: 22, accordion: 21, accordionLead: 21, synthLead: 81, pluck: 84,
    pad: 89, bell: 11,
  };
  const GM_DRUM = { kick: 36, snare: 38, clap: 39, hat: 42, ohat: 46, ride: 51, crash: 49, rim: 37, shaker: 70, perc: 81, tom: 45 };

  function vlq(n) {
    const bytes = [n & 0x7f];
    while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
    return bytes;
  }

  function track(events, name) {
    // events: {tick, data:[...]} — ordenados
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const bytes = [];
    const nameBytes = Array.from(new TextEncoder().encode(name));
    bytes.push(0, 0xff, 0x03, ...vlq(nameBytes.length), ...nameBytes);
    let last = 0;
    for (const e of events) {
      bytes.push(...vlq(Math.max(0, e.tick - last)), ...e.data);
      last = e.tick;
    }
    bytes.push(0, 0xff, 0x2f, 0);
    return [0x4d, 0x54, 0x72, 0x6b, ...u32(bytes.length), ...bytes];
  }

  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }

  function toMidi(song) {
    const PPQ = 480, tps = PPQ / 4; // ticks por semicolcheia
    const tracks = [];
    const tempo = Math.round(60000000 / song.bpm);
    tracks.push(track([
      { tick: 0, order: 0, data: [0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
      { tick: 0, order: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] },
    ], song.title || 'Música'));

    const noteTrack = (notes, inst, ch, name) => {
      const ev = [{ tick: 0, order: 0, data: [0xc0 | ch, GM_PROGRAM[inst] || 0] }];
      for (const n of notes) {
        const t0 = Math.round(n.step * tps), t1 = Math.round((n.step + n.dur) * tps) - 1;
        const vel = Math.max(1, Math.min(127, Math.round(n.vel * 110)));
        const m = Math.max(0, Math.min(127, Math.round(n.midi)));
        ev.push({ tick: t0, order: 2, data: [0x90 | ch, m, vel] });
        ev.push({ tick: Math.max(t0 + 1, t1), order: 1, data: [0x80 | ch, m, 0] });
      }
      tracks.push(track(ev, name));
    };
    noteTrack(song.parts.lead, song.instruments.lead, 0, 'Melodia');
    noteTrack(song.parts.chords, song.instruments.chords, 1, 'Harmonia');
    noteTrack(song.parts.bass, song.instruments.bass, 2, 'Baixo');
    if (song.parts.pad.length) noteTrack(song.parts.pad, song.instruments.pad, 3, 'Fundo');
    if (song.parts.lead2) noteTrack(song.parts.lead2, song.instruments.lead2, 4, 'Melodia 2');

    const dev = [];
    for (const d of song.parts.drums) {
      const n = GM_DRUM[d.lane]; if (!n) continue;
      const t0 = Math.round(d.step * tps);
      dev.push({ tick: t0, order: 2, data: [0x99, n, Math.round(d.vel * 110)] });
      dev.push({ tick: t0 + 60, order: 1, data: [0x89, n, 0] });
    }
    if (dev.length) tracks.push(track(dev, 'Bateria'));

    const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, (PPQ >> 8) & 255, PPQ & 255];
    const all = header.concat(...tracks);
    return new Blob([new Uint8Array(all)], { type: 'audio/midi' });
  }

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  global.Exporter = { mixStems, toWav, toMidi, download };
})(window);

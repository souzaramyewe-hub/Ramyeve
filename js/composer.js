/*
 * Compositor: transforma uma descrição (ou uma melodia cantada) em uma "partitura"
 * com bateria, baixo, harmonia, melodia e estrutura (intro, verso, refrão...).
 * Tempo em passos de semicolcheia; 16 passos por compasso.
 */
(function (global) {
  'use strict';
  const { SCALES, buildChord, voiceChord, degreeToMidi, rng, hash } = global.MT;
  const SPB = 16; // passos por compasso

  const VEL = { x: 1, o: 0.7, g: 0.4, r: 0.75 };

  const LENGTHS = {
    curta: [['intro', 2], ['verso', 4], ['refrao', 4], ['final', 2]],
    media: [['intro', 4], ['verso', 8], ['refrao', 8], ['verso', 8], ['refrao', 8], ['final', 4]],
    longa: [['intro', 4], ['verso', 8], ['refrao', 8], ['ponte', 4], ['verso', 8], ['refrao', 8], ['refrao', 8], ['final', 4]],
  };

  const SECTION_PT = { intro: 'Introdução', verso: 'Verso', refrao: 'Refrão', ponte: 'Ponte', final: 'Final', melodia: 'Sua melodia', variacao: 'Variação' };

  /* ---------------- Harmonia ---------------- */

  function chordOpts(style) {
    return {
      sevenths: !!(style.chords && style.chords.sevenths),
      dom7: !!(style.chords && style.chords.dom7),
      harmonicV: !!style.harmonicV,
    };
  }

  /* ---------------- Padrões de baixo ---------------- */

  function bassBar(type, chord, nextChord, key, mode, r, bassLo) {
    const rootM = lowNote(chord.root, bassLo);
    const fifth = rootM + 7;
    const third = lowNote(chord.pcs[1], rootM);
    const oct = rootM + 12;
    const nextRoot = lowNote(nextChord.root, bassLo);
    const N = (step, dur, midi, vel) => ({ step, dur, midi, vel: vel || 0.9 });
    switch (type) {
      case 'root8': return [0, 2, 4, 6, 8, 10, 12, 14].map((s) => N(s, 2, rootM, s % 4 ? 0.75 : 0.95));
      case 'root16': return Array.from({ length: 16 }, (_, s) => N(s, 1, rootM, s % 4 ? 0.7 : 0.95));
      case 'pop': return [N(0, 5, rootM), N(6, 2, rootM, 0.7), N(8, 4, rootM), N(12, 2, r.chance(0.5) ? fifth : oct, 0.75), N(14, 2, rootM, 0.7)];
      case 'samba': return [N(0, 3, rootM, 0.8), N(3, 1, fifth - 12, 0.6), N(4, 4, fifth - 12, 1), N(8, 3, rootM, 0.8), N(11, 1, fifth - 12, 0.6), N(12, 3, fifth - 12, 1), N(15, 1, nextRoot, 0.7)];
      case 'bossa': return [N(0, 5, rootM), N(6, 2, fifth - 12, 0.8), N(8, 5, fifth - 12), N(14, 2, rootM, 0.8)];
      case 'baiao': return [N(0, 3, rootM), N(3, 3, rootM, 0.8), N(6, 2, fifth - 12, 0.85), N(8, 3, rootM), N(11, 3, rootM, 0.8), N(14, 2, fifth - 12, 0.85)];
      case 'country': return [N(0, 4, rootM), N(4, 2, fifth - 12, 0.75), N(8, 4, fifth - 12 + (r.chance(0.5) ? 12 : 0)), N(12, 2, third, 0.75), N(14, 2, rootM, 0.7)];
      case 'reggae': return [N(2, 2, rootM, 0.9), N(4, 3, rootM, 0.85), N(8, 2, fifth - 12, 0.85), N(10, 2, third, 0.8), N(12, 4, rootM, 0.85)];
      case 'octave': return [0, 2, 4, 6, 8, 10, 12, 14].map((s) => N(s, 1.5, s % 4 ? oct : rootM, 0.85));
      case 'house': return [2, 6, 10, 14].map((s) => N(s, 2, rootM, 0.9));
      case '808': return [N(0, 7, rootM, 1), N(7, 3, rootM, 0.85), N(10, 6, r.chance(0.3) ? oct : rootM, 0.9)];
      case 'walking': {
        const scale = SCALES[mode] || SCALES.major;
        const passing = lowNote((key + scale[(chord.deg + 1) % 7]) % 12, rootM);
        const approach = nextRoot + (r.chance(0.5) ? 1 : -1);
        return [N(0, 4, rootM), N(4, 4, r.chance(0.5) ? third : passing, 0.8), N(8, 4, fifth, 0.85), N(12, 4, approach, 0.8)];
      }
      case 'half': return [N(0, 8, rootM, 0.8), N(8, 8, r.chance(0.5) ? fifth - 12 : rootM, 0.75)];
      case 'whole': return [N(0, 16, rootM, 0.7)];
      default: return [N(0, 8, rootM), N(8, 8, rootM)];
    }
  }

  function lowNote(pc, lo) {
    let m = lo - ((lo - pc) % 12 + 12) % 12;
    if (m < lo - 2) m += 12;
    return m;
  }

  /* ---------------- Padrões de acompanhamento ---------------- */

  function chordBar(rhythm, voicing, r, barIndex) {
    const all = (step, dur, vel) => voicing.map((m) => ({ step, dur, midi: m, vel: vel || 0.7 }));
    const arp = (steps, dur, notes) => steps.map((s, i) => ({ step: s, dur, midi: notes[i % notes.length], vel: 0.6 }));
    switch (rhythm) {
      case 'block': return all(0, 16, 0.55);
      case 'pop': return [].concat(all(0, 6, 0.7), all(6, 4, 0.55), all(10, 6, 0.6));
      case 'pulse8': return [0, 2, 4, 6, 8, 10, 12, 14].reduce((a, s) => a.concat(all(s, 1.6, s % 4 ? 0.65 : 0.85)), []);
      case 'pulse16': return Array.from({ length: 16 }).reduce((a, _, s) => a.concat(all(s, 0.7, s % 4 ? 0.6 : 0.85)), []);
      case 'skank': return [4, 12].reduce((a, s) => a.concat(all(s, 1.2, 0.7)), []);
      case 'samba': return [0, 2, 3, 5, 7, 8, 10, 11, 13, 15].reduce((a, s) => a.concat(all(s, 0.8, s % 4 === 0 ? 0.6 : 0.5)), []);
      case 'bossa': {
        const pats = [[0, 3, 6, 10, 12], [0, 3, 6, 8, 11, 14]];
        return pats[barIndex % 2].reduce((a, s) => a.concat(all(s, 1.6, 0.55)), []);
      }
      case 'baiao': return [0, 3, 6, 8, 11, 14].reduce((a, s) => a.concat(all(s, 1.5, s % 8 === 0 ? 0.65 : 0.5)), []);
      case 'strum': return [0, 4, 6, 8, 10, 12, 14].reduce((a, s) => a.concat(strum(voicing, s, 2, s % 4 === 0 ? 0.65 : 0.45, s % 4 === 2)), []);
      case 'stab': return [0, 3, 6, 10].reduce((a, s) => a.concat(all(s, 1, 0.55)), []);
      case 'dembow': return [3, 6, 11, 14].reduce((a, s) => a.concat(all(s, 1, 0.5)), []);
      case 'house': return [2, 6, 10, 14].reduce((a, s) => a.concat(all(s, 1.3, 0.6)), []);
      case 'comp': {
        const opts = [[3, 10], [0, 6, 14], [2, 8, 11], [4, 12]];
        return r.pick(opts).reduce((a, s) => a.concat(all(s, 2.5, 0.5)), []);
      }
      case 'shuffle': return [0, 4, 8, 12].reduce((a, s) => a.concat(all(s, 3, 0.55)), []);
      case 'lofi': return strum(voicing, 0, 12, 0.55, false).concat(strum(voicing, 12, 4, 0.4, false));
      case 'arp': {
        const notes = voicing.concat([voicing[0] + 12, voicing[1] + 12]);
        const order = [0, 1, 2, 3, 4, 3, 2, 1];
        return [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => ({ step: s, dur: 4, midi: notes[order[i] % notes.length], vel: 0.5 }));
      }
      case 'arp16': {
        const notes = voicing.concat(voicing.map((m) => m + 12));
        return arp(Array.from({ length: 16 }, (_, i) => i), 0.8, notes);
      }
      case 'alberti': {
        const [a, b, c] = voicing;
        const pat = [a, c, b, c];
        return Array.from({ length: 8 }, (_, i) => ({ step: i * 2, dur: 2, midi: pat[i % 4], vel: i % 4 === 0 ? 0.6 : 0.45 }));
      }
      default: return all(0, 16, 0.6);
    }
  }

  function strum(voicing, step, dur, vel, up) {
    const notes = up ? voicing.slice().reverse() : voicing;
    return notes.map((m, i) => ({ step: step + i * 0.06, dur: dur - i * 0.06, midi: m, vel: vel * (1 - i * 0.05) }));
  }

  /* ---------------- Bateria ---------------- */

  function drumBar(style, level, opts) {
    const out = [];
    if (style.noDrums || level <= 0) return out;
    const lanes = style.drums;
    for (const lane of Object.keys(lanes)) {
      if (level === 1 && (lane === 'snare' || lane === 'clap') && !opts.keepSnare) continue;
      const p = lanes[lane];
      for (let s = 0; s < 16; s++) {
        const ch = p[s];
        if (!ch || ch === '.') continue;
        const v = (VEL[ch] || 1) * (level === 1 ? 0.75 : 1);
        if (ch === 'r') {
          out.push({ step: s, lane, vel: v });
          out.push({ step: s + 0.5, lane, vel: v * 0.8 });
        } else out.push({ step: s, lane, vel: v });
      }
    }
    if (opts.fill) {
      const fillLane = lanes.snare ? 'snare' : (lanes.clap ? 'clap' : (lanes.rim ? 'rim' : null));
      if (fillLane) {
        for (let s = 12; s < 16; s++) out.push({ step: s, lane: fillLane, vel: 0.5 + (s - 12) * 0.15 });
        out.push({ step: 14, lane: 'tom', vel: 0.8 });
      }
    }
    if (opts.crash) out.push({ step: 0, lane: 'crash', vel: 0.8 });
    return out;
  }

  /* ---------------- Melodia ---------------- */

  function rhythmPattern(r, density, bars, busy) {
    const total = bars * SPB;
    const onsets = [];
    const grid = busy ? 1 : 2;
    for (let s = 0; s < total - 3; s += grid) {
      const inBar = s % SPB;
      let p = density * 0.6;
      if (inBar % 8 === 0) p += 0.35;
      else if (inBar % 4 === 0) p += 0.2;
      else if (inBar % 2 === 1) p *= 0.4;
      if (s === 0) p = 0.95;
      if (s > total - 6) p *= 0.3; // respiro no fim da frase
      if (r() < p) onsets.push(s);
    }
    if (!onsets.length) onsets.push(0);
    return toNotes(onsets, total);
  }

  function lyricRhythm(r, nSyl, bars) {
    const total = bars * SPB;
    const usable = total - 4;
    let grid = 2;
    if (nSyl > usable / 2) grid = 1;
    const slots = [];
    for (let s = 0; s < usable; s += grid) slots.push(s);
    const n = Math.min(nSyl, slots.length);
    const picked = new Set();
    // distribui as sílabas com um leve ritmo "falado" (agrupadas no começo)
    for (let i = 0; i < n; i++) {
      const ideal = Math.pow(i / Math.max(1, n), 0.92) * slots.length;
      let idx = Math.min(slots.length - 1, Math.round(ideal + (r() - 0.5) * 1.2));
      while (picked.has(idx) && idx < slots.length - 1) idx++;
      while (picked.has(idx) && idx > 0) idx--;
      picked.add(idx);
    }
    const onsets = Array.from(picked).sort((a, b) => a - b).map((i) => slots[i]);
    return toNotes(onsets, total);
  }

  function toNotes(onsets, total) {
    return onsets.map((s, i) => {
      const next = i + 1 < onsets.length ? onsets[i + 1] : Math.min(total, s + 8);
      return { step: s, dur: Math.max(1, Math.min(8, next - s)) };
    });
  }

  /* Escolhe alturas em "espaço de graus" para seguir os acordes. */
  function pitchPhrase(r, rhythm, chordsByBar, startBar, regBase, lastDeg) {
    let cur = lastDeg == null ? 4 + regBase : lastDeg;
    const total = rhythm.length;
    const lo = regBase - 1, hi = regBase + 9;
    return rhythm.map((n, i) => {
      const bar = startBar + Math.floor(n.step / SPB);
      const chord = chordsByBar[Math.min(bar, chordsByBar.length - 1)];
      const isChordTone = (d) => [0, 2, 4].includes((((d - chord.deg) % 7) + 7) % 7);
      const progress = i / Math.max(1, total - 1);
      const dir = progress < 0.55 ? 1 : -1; // arco: sobe e depois desce
      const strong = (n.step % 8 === 0) || n.dur >= 4 || i === total - 1;
      if (strong) {
        const cands = [];
        for (let d = lo; d <= hi; d++) if (isChordTone(d)) cands.push(d);
        cands.sort((a, b) => scoreTone(a) - scoreTone(b));
        cur = cands[0];
        if (i === total - 1) { // termina na fundamental ou terça
          const fin = cands.filter((d) => [0, 2].includes((((d - chord.deg) % 7) + 7) % 7));
          fin.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
          if (fin.length) cur = fin[0];
        }
      } else {
        const step = r.weighted([[1, 0.55], [2, 0.25], [0, 0.12], [3, 0.08]]);
        const d = r.chance(0.75) ? dir : -dir;
        cur += step * d;
      }
      if (cur > hi) cur -= 2;
      if (cur < lo) cur += 2;
      return { step: n.step, dur: n.dur, deg: cur };

      function scoreTone(d) {
        const target = cur + dir * (r() < 0.5 ? 1 : 2);
        return Math.abs(d - target) + (d === cur ? 0.6 : 0);
      }
    });
  }

  /* ---------------- Montagem final ---------------- */

  function makeSong(base) {
    return Object.assign({
      stepsPerBar: SPB,
      parts: { drums: [], bass: [], chords: [], pad: [], lead: [] },
      sections: [],
      chordNames: [],
    }, base);
  }

  function addSectionParts(song, ctx) {
    const { style, r, chords, startBar, bars, section, nextSection } = ctx;
    const startStep = startBar * SPB;
    let prevVoicing = song._prevVoicing || null;
    const lightDrums = song.lightDrums;
    for (let b = 0; b < bars; b++) {
      const chord = chords[b];
      const next = chords[b + 1] || chords[0];
      const barStart = startStep + b * SPB;
      const isLast = b === bars - 1;
      const finalBar = section === 'final' && isLast;
      song.chordNames.push({ bar: startBar + b, name: chord.name });

      // Bateria
      let level = { intro: 1, verso: lightDrums ? 1 : 2, refrao: 2, ponte: 1, final: 1, melodia: 2, variacao: 2 }[section];
      if (lightDrums && section === 'refrao') level = 1;
      if (section === 'intro' && b < bars / 2 && bars >= 4) level = 0;
      if (finalBar) {
        if (!style.noDrums) {
          song.parts.drums.push({ step: barStart, lane: 'crash', vel: 0.9 });
          song.parts.drums.push({ step: barStart, lane: 'kick', vel: 1 });
        }
      } else {
        const fill = isLast && (nextSection === 'refrao' || nextSection === 'variacao') && !style.noDrums;
        const crash = b === 0 && (section === 'refrao' || section === 'variacao') && !style.noDrums;
        for (const d of drumBar(style, level, { fill, crash, keepSnare: section === 'verso' || section === 'melodia' })) {
          song.parts.drums.push({ step: barStart + d.step, lane: d.lane, vel: d.vel });
        }
      }

      // Baixo
      if (section !== 'intro' || b >= bars / 2) {
        if (finalBar) song.parts.bass.push({ step: barStart, dur: 16, midi: lowNote(chord.root, song.bassLo), vel: 0.9 });
        else for (const n of bassBar(style.bass, chord, next, song.key, song.mode, r, song.bassLo)) {
          song.parts.bass.push(Object.assign({}, n, { step: barStart + n.step }));
        }
      }

      // Acordes
      const pcs = style.chords.power ? [chord.root, (chord.root + 7) % 12] : chord.pcs;
      let voicing = voiceChord(pcs, prevVoicing, style.chords.power ? 40 : 52, style.chords.power ? 62 : 74);
      if (style.chords.power) voicing = voicing.concat([voicing[0] + 12]);
      prevVoicing = voicing;
      const rhythm = finalBar ? 'block' : (section === 'intro' && style.chords.rhythm === 'pulse16' ? 'pulse8' : style.chords.rhythm);
      for (const n of chordBar(rhythm, voicing, r, startBar + b)) {
        song.parts.chords.push(Object.assign({}, n, { step: barStart + n.step }));
      }

      // Pad (camada de fundo) no refrão / variação / estilos atmosféricos
      if (song.instruments.pad && (section === 'refrao' || section === 'variacao' || section === 'ponte' || style.noDrums || song.epic)) {
        const padV = voiceChord(chord.pcs, null, 55, 72);
        for (const m of padV) song.parts.pad.push({ step: barStart, dur: 16, midi: m, vel: 0.45 });
      }
    }
    song._prevVoicing = prevVoicing;
  }

  function sectionChords(style, key, mode, prog, bars) {
    const opts = chordOpts(style);
    const out = [];
    for (let b = 0; b < bars; b++) out.push(buildChord(key, mode, prog[b % prog.length], opts));
    return out;
  }

  /* ================= Composição a partir de TEXTO ================= */

  function composeFromText(o) {
    const a = global.TextAnalyzer.analyze(o.prompt, o.lyrics);
    const style = (o.styleId && o.styleId !== 'auto') ? global.STYLES.byId[o.styleId] : a.style;
    const seed = hash((o.prompt || '') + '|' + (o.lyrics || '') + '|' + style.id + '|' + (o.variation || 0));
    const r = rng(seed);

    let mode = a.mode || style.mode;
    if (style.mode === 'mixolydian' && a.mode === 'major') mode = 'mixolydian';
    if (o.mode && o.mode !== 'auto') mode = o.mode;
    let key = a.key != null ? a.key : r.pick([0, 2, 4, 5, 7, 9, 10]);
    if (o.key != null && o.key !== 'auto') key = parseInt(o.key, 10);

    let bpm = a.bpm || Math.round((style.bpm[0] + r() * (style.bpm[1] - style.bpm[0])) * a.bpmMul);
    if (o.bpm) bpm = o.bpm;
    bpm = Math.max(50, Math.min(200, bpm));

    const density = Math.max(0.15, Math.min(0.95, style.density * a.densityMul));
    const progs = global.STYLES.getProgressions(style, mode);
    const progVerse = r.pick(progs);
    let progChorus = r.pick(progs);
    if (progs.length > 1) while (progChorus === progVerse) progChorus = r.pick(progs);
    const progBridge = progChorus.slice().reverse();

    const song = makeSong({
      title: a.title, style, key, mode, bpm, seed, source: 'texto',
      swing: style.swing || 0, swingUnit: style.swingUnit || 16,
      bassLo: 33 + (style.bass === '808' ? 0 : 3),
      lightDrums: a.lightDrums, epic: a.epic,
      moods: a.moods, inferred: a.inferred && (!o.styleId || o.styleId === 'auto'),
      instruments: {
        drums: 'kit', bass: style.bassInst,
        chords: a.instruments.chords || style.chords.inst,
        pad: a.instruments.pad || (a.epic ? 'strings' : style.pad || null),
        lead: a.instruments.lead || style.lead,
      },
    });

    const plan = LENGTHS[o.length] || LENGTHS.media;
    const melodyCache = {};
    let bar = 0;
    let lastDeg = null;
    const stanzas = a.stanzas;
    let stanzaIdx = { verso: 0 };

    plan.forEach(([section, bars], si) => {
      const nextSection = plan[si + 1] ? plan[si + 1][0] : null;
      const prog = section === 'refrao' ? progChorus : section === 'ponte' ? progBridge : progVerse;
      const chords = style.id === 'blues'
        ? sectionChords(style, key, mode, prog, bars).map((c, i) => buildChord(key, mode, prog[(bar + i) % prog.length], chordOpts(style)))
        : sectionChords(style, key, mode, prog, bars);
      song.sections.push({ name: section, label: SECTION_PT[section], startBar: bar, bars });
      addSectionParts(song, { style, r, chords, startBar: bar, bars, section, nextSection });

      // Melodia (verso, refrão, ponte)
      if (section === 'verso' || section === 'refrao' || section === 'ponte') {
        let lines = null;
        if (stanzas.length) {
          if (section === 'refrao') lines = stanzas.length > 1 ? stanzas[1] : stanzas[0];
          else if (section === 'verso') {
            const pool = stanzas.filter((_, i) => i !== 1 || stanzas.length === 1);
            lines = pool[stanzaIdx.verso % pool.length];
            stanzaIdx.verso++;
          } else lines = stanzas[2] || null;
        }
        const cacheKey = section + '|' + (lines ? lines.map((l) => l.join('')).join('/') : '');
        let mel = melodyCache[cacheKey];
        if (!mel) {
          mel = buildMelody(rng(hash(cacheKey + seed)), chords, bars, section, density, style, lines, lastDeg);
          melodyCache[cacheKey] = mel;
        }
        const scale = SCALES[mode] || SCALES.major;
        const regBase = 60;
        for (const n of mel) {
          song.parts.lead.push({
            step: bar * SPB + n.step, dur: n.dur, vel: n.vel || 0.85,
            midi: degreeToMidi(key, scale, n.deg, key > 6 ? regBase - 12 : regBase), syl: n.syl,
          });
        }
        if (mel.length) lastDeg = mel[mel.length - 1].deg;
      }
      bar += bars;
    });

    song.totalBars = bar;
    delete song._prevVoicing;
    return song;
  }

  function buildMelody(r, chords, bars, section, density, style, lines, lastDeg) {
    const phraseBars = 2;
    const phrases = Math.ceil(bars / phraseBars);
    const regBase = section === 'refrao' ? 4 : 2; // refrão mais agudo
    const dens = section === 'refrao' ? Math.min(0.95, density * 1.15) : density;
    const busy = style.id === 'trap' || style.id === 'samba' || style.id === 'funkbr' || style.id === 'reggaeton';
    const motifA = rhythmPattern(r, dens, phraseBars, busy);
    const motifB = rhythmPattern(r, dens, phraseBars, busy);
    const out = [];
    let prev = lastDeg;
    for (let p = 0; p < phrases; p++) {
      let rhythm, syls = null;
      if (lines && lines.length) {
        syls = lines[p % lines.length];
        rhythm = lyricRhythm(rng(hash(syls.join('') + p)), syls.length, phraseBars);
      } else {
        rhythm = (p % 4 === 2) ? motifB : motifA;
        if (p === phrases - 1) { // última frase: nota final longa
          rhythm = rhythm.filter((n) => n.step < 20);
          if (rhythm.length) rhythm[rhythm.length - 1].dur = Math.max(rhythm[rhythm.length - 1].dur, 24 - rhythm[rhythm.length - 1].step);
        }
      }
      const pr = rng(hash('phrase' + (p % 2) + section) ^ (r() * 1e9));
      const notes = pitchPhrase(pr, rhythm, chords, p * phraseBars, regBase, prev);
      notes.forEach((n, i) => {
        const step = p * phraseBars * SPB + n.step;
        if (step >= bars * SPB) return;
        out.push({ step, dur: Math.min(n.dur, bars * SPB - step), deg: n.deg, syl: syls ? syls[i] : undefined, vel: n.step % 4 === 0 ? 0.9 : 0.75 });
      });
      if (notes.length) prev = notes[notes.length - 1].deg;
    }
    return out;
  }

  /* ================= Composição a partir da VOZ ================= */

  function estimateTempo(notes, prefer) {
    if (notes.length < 4) return prefer;
    const t0 = notes[0].start;
    const onsets = notes.map((n) => n.start - t0);
    let best = prefer, bestScore = Infinity;
    for (let bpm = 60; bpm <= 180; bpm++) {
      const grid = 60 / bpm / 2; // colcheia
      let err = 0;
      for (const o of onsets) {
        const k = o / grid;
        err += Math.abs(k - Math.round(k));
      }
      const score = err / onsets.length + 0.0025 * Math.abs(bpm - prefer);
      if (score < bestScore) { bestScore = score; best = bpm; }
    }
    return best;
  }

  function harmonize(melNotes, bars, key, mode, style, prog) {
    const opts = chordOpts(style);
    const cands = [0, 1, 2, 3, 4, 5, 6].map((d) => buildChord(key, mode, d, opts));
    const out = [];
    let prev = null;
    for (let b = 0; b < bars; b++) {
      const w = new Array(12).fill(0);
      for (const n of melNotes) {
        const s0 = Math.max(n.step, b * SPB), s1 = Math.min(n.step + n.dur, (b + 1) * SPB);
        if (s1 > s0) w[((n.midi % 12) + 12) % 12] += (s1 - s0) * (n.step >= b * SPB && n.step % 4 === 0 ? 1.5 : 1);
      }
      const styleDeg = prog[b % prog.length];
      let best = null, bestScore = -Infinity;
      for (const c of cands) {
        let s = 0;
        for (let pc = 0; pc < 12; pc++) {
          if (!w[pc]) continue;
          if (c.pcs.slice(0, 3).includes(pc)) s += w[pc] * (pc === c.root ? 1.2 : 1);
          else s -= w[pc] * 0.6;
        }
        if (c.deg === styleDeg) s += 1.5;
        if (c.deg === 0) s += 0.8;
        if (c.deg === 3 || c.deg === 4) s += 0.4;
        if (c.deg === 6) s -= 1.5;
        if (prev && prev.deg === c.deg) s -= 1.2;
        if (b === bars - 1 && c.deg === 0) s += 2; // termina na tônica
        if (s > bestScore) { bestScore = s; best = c; }
      }
      out.push(best);
      prev = best;
    }
    return out;
  }

  function composeFromVoice(o) {
    const vNotes = o.notes;
    if (!vNotes || !vNotes.length) throw new Error('Nenhuma nota foi detectada na gravação.');
    const a = global.TextAnalyzer.analyze(o.prompt || '', '');
    const style = (o.styleId && o.styleId !== 'auto') ? global.STYLES.byId[o.styleId] : a.style;
    const seed = hash(vNotes.map((n) => Math.round(n.midi)).join(',') + style.id + (o.variation || 0));
    const r = rng(seed);

    const det = global.MT.detectKey(vNotes);
    let key = det.key, mode = det.mode;
    if (o.key != null && o.key !== 'auto') key = parseInt(o.key, 10);
    if (o.mode && o.mode !== 'auto') mode = o.mode;

    const prefer = Math.round((style.bpm[0] + style.bpm[1]) / 2);
    let bpm = o.bpm || a.bpm || estimateTempo(vNotes, prefer);
    // dobra/divide para cair na faixa do estilo
    if (!o.bpm && !a.bpm) {
      while (bpm < style.bpm[0] - 15 && bpm * 2 <= 200) bpm *= 2;
      while (bpm > style.bpm[1] + 20 && bpm / 2 >= 50) bpm /= 2;
      bpm = Math.round(bpm);
    }

    // Quantiza a melodia para a grade de semicolcheias
    const t0 = vNotes[0].start;
    const stepSec = 60 / bpm / 4;
    let mel = [];
    for (const n of vNotes) {
      const step = Math.round((n.start - t0) / stepSec);
      const dur = Math.max(1, Math.round(n.dur / stepSec));
      const last = mel[mel.length - 1];
      if (last && step <= last.step) continue;
      if (last && last.step + last.dur > step) last.dur = step - last.step;
      mel.push({ step, dur, midi: Math.round(n.midi) });
    }
    // transposição de oitava para o registro do instrumento
    const avgMidi = mel.reduce((s, n) => s + n.midi, 0) / mel.length;
    const shift = Math.round((70 - avgMidi) / 12) * 12;
    const keyShift = (o.key != null && o.key !== 'auto') ? (((key - det.key) % 12) + 18) % 12 - 6 : 0;
    mel = mel.map((n) => Object.assign(n, { midi: n.midi + shift + keyShift }));

    const melSteps = mel[mel.length - 1].step + mel[mel.length - 1].dur;
    const melBars = Math.max(2, Math.min(16, Math.ceil(melSteps / SPB / 2) * 2));
    mel = mel.filter((n) => n.step < melBars * SPB);

    const progs = global.STYLES.getProgressions(style, mode);
    const prog = r.pick(progs);
    const chords = harmonize(mel, melBars, key, mode, style, prog);

    const instruments = {
      drums: 'kit', bass: style.bassInst,
      chords: a.instruments.chords || style.chords.inst,
      pad: a.instruments.pad || style.pad || null,
      lead: a.instruments.lead || style.lead,
    };
    const song = makeSong({
      title: o.title || ('Minha melodia em ' + style.name), style, key, mode, bpm, seed, source: 'voz',
      swing: style.swing || 0, swingUnit: style.swingUnit || 16,
      bassLo: 33 + (style.bass === '808' ? 0 : 3), lightDrums: a.lightDrums, epic: a.epic,
      moods: a.moods, inferred: false, instruments,
    });

    const introBars = 2;
    const plan = [['intro', introBars, chords.slice(-introBars)], ['melodia', melBars, chords], ['variacao', melBars, chords], ['final', 2, [chords[chords.length - 1], buildChord(key, mode, 0, chordOpts(style))]]];
    let bar = 0;
    plan.forEach(([section, bars, chs], si) => {
      const nextSection = plan[si + 1] ? plan[si + 1][0] : null;
      song.sections.push({ name: section, label: SECTION_PT[section], startBar: bar, bars });
      addSectionParts(song, { style, r, chords: chs, startBar: bar, bars, section, nextSection });
      if (section === 'melodia' || section === 'variacao') {
        for (const n of mel) {
          song.parts.lead.push({ step: bar * SPB + n.step, dur: n.dur, midi: n.midi, vel: 0.85 });
        }
        if (section === 'melodia') {
          song.voiceStartSec = bar * SPB * stepSec; // onde a voz original entra
          song.voiceOffsetSec = t0;
        }
      }
      bar += bars;
    });
    // Na variação, a melodia é dobrada uma oitava acima com outro timbre.
    song.parts.lead2 = mel.map((n) => ({ step: (introBars + melBars) * SPB + n.step, dur: n.dur, midi: n.midi + 12, vel: 0.5 }));
    song.instruments.lead2 = instruments.lead === 'bell' ? 'flute' : 'bell';
    song.totalBars = bar;
    song.detectedKey = det;
    delete song._prevVoicing;
    return song;
  }

  global.Composer = { composeFromText, composeFromVoice, SPB, SECTION_PT, estimateTempo };
})(window);

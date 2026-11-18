/*
 * Tocador de amostras: toca instrumentos e baterias GRAVADOS (js/samples/*.js).
 * Cada instrumento guarda uma gravação a cada 3 semitons; as notas do meio
 * são obtidas mudando levemente a velocidade da gravação mais próxima.
 * Se um banco não estiver disponível, o app usa o sintetizador como reserva.
 */
(function (global) {
  'use strict';

  const BANK = () => global.RAMYEVE_SAMPLES || {};
  const decoded = {};   // chave -> { kind, notes:[{midi, buf, loop}] } ou { kind, sounds:{faixa: buf} }
  const loading = {};
  let dctx = null;

  /* instrumento do app -> banco gravado (os que não estão aqui continuam sintetizados) */
  const INSTRUMENT_BANK = {
    piano: 'piano', epiano: 'epiano', organ: 'organ',
    nylon: 'nylon', steelGuitar: 'steelGuitar', cavaco: 'steelGuitar',
    distGuitar: 'distGuitar', leadGuitar: 'leadGuitar',
    acousticBass: 'acousticBass', pickBass: 'pickBass', fingerBass: 'fingerBass',
    violin: 'violin', cello: 'cello', strings: 'strings',
    sax: 'sax', flute: 'flute', accordion: 'accordion', accordionLead: 'accordion',
    melodica: 'harmonica', bell: 'vibes',
  };
  const RELEASE = { piano: 0.35, epiano: 0.3, vibes: 0.5, nylon: 0.25, steelGuitar: 0.25, acousticBass: 0.12, pickBass: 0.1, fingerBass: 0.12 };
  const KIT_808 = new Set(['trap', 'funkbr', 'house', 'techno', 'reggaeton']);

  function b64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }

  /* remove o silêncio inicial que o decodificador de MP3 acrescenta (atrasaria o ritmo) */
  function trimLead(buf) {
    const d = buf.getChannelData(0);
    let i = 0;
    while (i < d.length && Math.abs(d[i]) < 0.002) i++;
    i = Math.max(0, i - Math.floor(buf.sampleRate * 0.001));
    if (i === 0) return buf;
    const out = new AudioBuffer({ numberOfChannels: 1, length: Math.max(1, d.length - i), sampleRate: buf.sampleRate });
    out.copyToChannel(d.subarray(i), 0);
    return out;
  }

  /* ponto de laço num cruzamento por zero (evita estalos) */
  function zeroCross(d, sr, sec) {
    let i = Math.min(d.length - 2, Math.floor(sec * sr));
    const lim = Math.min(d.length - 2, i + Math.floor(sr * 0.02));
    while (i < lim && !(d[i] <= 0 && d[i + 1] > 0)) i++;
    return i / sr;
  }

  async function decode(b64) {
    if (!dctx) dctx = new OfflineAudioContext(1, 1, 44100);
    return trimLead(await dctx.decodeAudioData(b64ToArrayBuffer(b64)));
  }

  function loadScript(key) {
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'js/samples/' + key + '.js';
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  async function ensure(key) {
    if (decoded[key]) return true;
    if (loading[key]) return loading[key];
    loading[key] = (async () => {
      if (!BANK()[key] && !(await loadScript(key))) return false;
      const data = BANK()[key];
      if (!data) return false;
      try {
        if (data.kind === 'drums') {
          const sounds = {};
          await Promise.all(Object.entries(data.sounds).map(async ([lane, b64]) => { sounds[lane] = await decode(b64); }));
          decoded[key] = { kind: 'drums', sounds };
        } else {
          const notes = await Promise.all(Object.entries(data.notes).map(async ([m, b64]) => {
            const buf = await decode(b64);
            let loop = null;
            if (data.loop && buf.duration > data.loop[1]) {
              const d = buf.getChannelData(0);
              loop = [zeroCross(d, buf.sampleRate, data.loop[0]), zeroCross(d, buf.sampleRate, data.loop[1])];
            }
            return { midi: +m, buf, loop };
          }));
          notes.sort((a, b) => a.midi - b.midi);
          decoded[key] = { kind: 'melodic', notes };
        }
        return true;
      } catch (e) {
        console.warn('banco de sons indisponível:', key, e);
        return false;
      }
    })();
    return loading[key];
  }

  function kitFor(style) { return 'kit-' + (KIT_808.has(style.id) ? '808' : 'acoustic'); }

  /* Carrega (uma vez) os bancos que a música usa. */
  async function ensureForSong(song) {
    const keys = new Set();
    for (const inst of Object.values(song.instruments || {})) if (INSTRUMENT_BANK[inst]) keys.add(INSTRUMENT_BANK[inst]);
    if (!song.style.noDrums) keys.add(kitFor(song.style));
    await Promise.all([...keys].map(ensure));
  }

  function bankFor(instName) {
    const key = INSTRUMENT_BANK[instName];
    return key && decoded[key] ? key : null;
  }

  /* Toca uma nota gravada. Retorna false se o instrumento não tem banco. */
  function playNote(ctx, out, t, midi, dur, vel, instName) {
    const key = bankFor(instName);
    if (!key) return false;
    if (instName === 'cavaco') { midi += 12; dur = Math.min(dur, 0.25); }
    const notes = decoded[key].notes;
    let best = notes[0];
    for (const n of notes) if (Math.abs(n.midi - midi) < Math.abs(best.midi - midi)) best = n;
    const src = ctx.createBufferSource();
    src.buffer = best.buf;
    src.playbackRate.value = Math.pow(2, (midi - best.midi) / 12);
    const rate = src.playbackRate.value;
    const natural = best.buf.duration / rate;
    if (best.loop && dur > best.loop[1] / rate - 0.1) {
      src.loop = true;
      src.loopStart = best.loop[0];
      src.loopEnd = best.loop[1];
    }
    const rel = RELEASE[key] || 0.15;
    const g = ctx.createGain();
    const level = Math.pow(Math.max(0.05, vel), 1.3) * 0.9;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.004);
    const endT = t + (src.loop ? dur : Math.min(dur, natural));
    g.gain.setValueAtTime(level, endT);
    g.gain.setTargetAtTime(0, endT, rel / 3);
    // notas fracas soam mais escuras, como num instrumento de verdade
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2500 + vel * 14000;
    src.connect(lp).connect(g).connect(out);
    src.start(t);
    src.stop(endT + rel + 0.05);
    return true;
  }

  /* Toca um som de bateria gravado. Retorna false se não houver. */
  function playDrum(ctx, out, t, lane, vel, style) {
    const kit = decoded[kitFor(style)];
    if (!kit) return false;
    let name = lane;
    if (lane === 'perc') {
      if (style.id === 'forro') return false;          // triângulo continua sintetizado
      name = style.id === 'funkbr' ? 'tom' : 'cowbell';
    }
    const buf = kit.sounds[name];
    if (!buf) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = Math.pow(Math.max(0.05, vel), 1.2) * (lane === 'hat' || lane === 'shaker' ? 0.7 : 1);
    src.connect(g).connect(out);
    src.start(t);
    return true;
  }

  global.Sampler = { ensure, ensureForSong, playNote, playDrum, bankFor, INSTRUMENT_BANK };
})(window);

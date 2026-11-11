/* Interpreta a descrição em texto: estilo, clima, andamento, tom, instrumentos e letra. */
(function (global) {
  'use strict';

  function normalize(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  const MOODS = [
    { id: 'triste', words: ['triste', 'tristeza', 'melancol', 'saudade', 'chorar', 'choro', 'sozinho', 'solidao', 'sad', 'adeus', 'perdi', 'sombri', 'escur'], mode: 'minor', bpm: 0.88, density: 0.85 },
    { id: 'alegre', words: ['alegre', 'alegria', 'feliz', 'felicidade', 'festa', 'verao', 'praia', 'sorriso', 'happy', 'divert', 'animad', 'celebr'], mode: 'major', bpm: 1.06, density: 1.1 },
    { id: 'calmo', words: ['calmo', 'calma', 'tranquil', 'suave', 'relax', 'leve', 'paz', 'devagar', 'lento', 'lenta', 'dormir', 'ninar', 'acustic'], bpm: 0.85, density: 0.75, lightDrums: true },
    { id: 'energetico', words: ['energ', 'agitad', 'intens', 'rapido', 'rapida', 'forte', 'explos', 'treino', 'academia', 'corrida', 'pular', 'acelerad'], bpm: 1.12, density: 1.25 },
    { id: 'romantico', words: ['romant', 'amor', 'paixao', 'beijo', 'namor', 'coracao', 'apaixon'], mode: 'major', bpm: 0.92, density: 0.9 },
    { id: 'misterioso', words: ['misterio', 'suspense', 'tenso', 'terror', 'medo', 'noite', 'sombra'], mode: 'minor', bpm: 0.95, density: 0.8 },
    { id: 'epico', words: ['epico', 'epica', 'heroi', 'batalha', 'vitoria', 'grandioso', 'cinematograf', 'guerra'], mode: 'minor', bpm: 1.0, density: 1.1, epic: true },
  ];

  const INSTRUMENTS = [
    { words: ['piano'], lead: 'piano', chords: 'piano' },
    { words: ['violao', 'acustico'], chords: 'steelGuitar' },
    { words: ['violao de nylon', 'nylon'], chords: 'nylon' },
    { words: ['guitarra'], lead: 'leadGuitar' },
    { words: ['sanfona', 'acordeon', 'acordeao', 'gaita'], lead: 'accordionLead' },
    { words: ['sax', 'saxofone'], lead: 'sax' },
    { words: ['flauta'], lead: 'flute' },
    { words: ['violino', 'cordas', 'orquestra'], lead: 'violin', pad: 'strings' },
    { words: ['sintetizador', 'synth', 'teclado'], lead: 'synthLead' },
    { words: ['orgao', 'organ'], chords: 'organ' },
    { words: ['sino', 'sinos', 'caixinha de musica', 'xilofone'], lead: 'bell' },
    { words: ['cavaco', 'cavaquinho'], chords: 'cavaco' },
  ];

  const NOTE_WORDS = { do: 0, c: 0, re: 2, d: 2, mi: 4, e: 4, fa: 5, f: 5, sol: 7, g: 7, la: 9, a: 9, si: 11, b: 11 };

  function has(text, word) {
    const w = normalize(word);
    if (w.length <= 3) return new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)').test(text);
    return text.includes(w);
  }

  function detectStyle(text) {
    const scores = [];
    for (const s of global.STYLES.list) {
      let score = 0;
      if (has(text, s.name.split(' ')[0])) score += 2;
      for (const k of s.keywords) if (has(text, k)) score += 1 + k.length / 20;
      if (score > 0) scores.push({ style: s, score });
    }
    scores.sort((a, b) => b.score - a.score);
    return scores.map((x) => x.style);
  }

  function detectKey(text) {
    // "em Lá menor", "tom de C#", "tonalidade Ré maior", "em Am"
    const re = /(?:\bem|\btom(?: de)?|\btonalidade(?: de)?|\bkey(?: of)?)\s+(do|re|mi|fa|sol|la|si|[a-g])(#|b|\s+sustenido|\s+bemol)?(?:\s*(maior|menor|major|minor|m))?(?![a-z#])/;
    const m = text.match(re);
    if (!m) return null;
    let pc = NOTE_WORDS[m[1]];
    if (pc === undefined) return null;
    const acc = (m[2] || '').trim();
    if (acc === '#' || acc === 'sustenido') pc += 1;
    if (acc === 'b' || acc === 'bemol') pc -= 1;
    const mode = m[3] ? (/^(menor|minor|m)$/.test(m[3]) ? 'minor' : 'major') : null;
    return { key: (pc + 12) % 12, mode };
  }

  /* Divide uma palavra em sílabas (aproximação para português). */
  function syllabify(word) {
    const V = 'aeiouáéíóúâêôãõàüy';
    const re = new RegExp('[^' + V + ']*[' + V + ']+(?:[^' + V + ']*$|[^' + V + '](?=[^' + V + ']))?', 'gi');
    const parts = word.match(re);
    return parts && parts.length ? parts : [word];
  }

  function lyricsToStanzas(lyrics) {
    const raw = (lyrics || '').trim();
    if (!raw) return [];
    const stanzas = raw.split(/\n\s*\n/).map((st) => {
      let lines = st.split('\n').map((l) => l.trim()).filter(Boolean);
      // linhas muito longas são quebradas em frases de ~8 sílabas
      const out = [];
      for (const line of lines) {
        const syl = [];
        for (const w of line.split(/\s+/).filter(Boolean)) {
          const parts = syllabify(w.replace(/[^\p{L}\p{N}'-]/gu, '') || w);
          parts.forEach((p, i) => syl.push(i === parts.length - 1 ? p : p + '-'));
        }
        for (let i = 0; i < syl.length; i += 12) out.push(syl.slice(i, i + 12));
      }
      return out;
    });
    return stanzas.filter((s) => s.length);
  }

  function makeTitle(prompt, style) {
    const quoted = (prompt || '').match(/["“”']([^"“”']{2,40})["“”']/);
    if (quoted) return quoted[1];
    const sobre = (prompt || '').match(/sobre\s+(?:o|a|os|as|um|uma)?\s*([^,.;\n]{2,30})/i);
    if (sobre) {
      const t = sobre[1].trim();
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    const STOP = ['de', 'da', 'do', 'das', 'dos', 'em', 'com', 'para', 'pra', 'uma', 'um', 'sobre', 'que', 'no', 'na', 'nos', 'nas', 'e', 'o', 'a', 'os', 'as', 'musica', 'maior', 'menor', 'bpm', 'estilo', 'tipo', 'quero', 'faca', 'crie'];
    const words = (prompt || '').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.includes(normalize(w))).slice(0, 3);
    if (words.length) return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return 'Minha música ' + style.name;
  }

  function analyze(prompt, lyrics) {
    const text = normalize((prompt || '') + ' ' + (lyrics || ''));
    const promptText = normalize(prompt || '');
    const styles = detectStyle(promptText).concat(detectStyle(text));
    const moods = MOODS.filter((m) => m.words.some((w) => new RegExp('(^|[^a-z])' + w).test(text)));

    let bpm = null;
    const mb = promptText.match(/(\d{2,3})\s*bpm/);
    if (mb) bpm = Math.max(50, Math.min(200, parseInt(mb[1], 10)));

    let mode = null;
    for (const m of moods) if (m.mode && !mode) mode = m.mode;
    if (/\bmaior\b/.test(promptText) && !/menor/.test(promptText)) mode = 'major';

    const key = detectKey(promptText);
    if (key && key.mode) mode = key.mode;

    const inst = {};
    for (const i of INSTRUMENTS) {
      if (i.words.some((w) => has(promptText, w))) {
        if (i.lead) inst.lead = i.lead;
        if (i.chords) inst.chords = i.chords;
        if (i.pad) inst.pad = i.pad;
      }
    }

    let bpmMul = 1, densityMul = 1, lightDrums = false, epic = false;
    for (const m of moods) {
      bpmMul *= m.bpm || 1;
      densityMul *= m.density || 1;
      if (m.lightDrums) lightDrums = true;
      if (m.epic) epic = true;
    }

    // Sem estilo explícito: inferir pelo clima.
    let style = styles[0] || null;
    let inferred = false;
    if (!style) {
      inferred = true;
      const ids = moods.map((m) => m.id);
      if (ids.includes('epico')) style = global.STYLES.byId.classica;
      else if (ids.includes('calmo')) style = global.STYLES.byId.lofi;
      else if (ids.includes('romantico') || ids.includes('triste')) style = global.STYLES.byId.balada;
      else if (ids.includes('energetico')) style = global.STYLES.byId.rock;
      else if (ids.includes('alegre')) style = global.STYLES.byId.pop;
      else style = global.STYLES.byId.pop;
    }

    return {
      style, inferred, secondary: styles.find((s) => s !== style) || null,
      moods: moods.map((m) => m.id), mode, key: key ? key.key : null, bpm,
      bpmMul, densityMul, lightDrums, epic, instruments: inst,
      stanzas: lyricsToStanzas(lyrics), title: makeTitle(prompt, style),
    };
  }

  global.TextAnalyzer = { analyze, normalize, syllabify };
})(window);

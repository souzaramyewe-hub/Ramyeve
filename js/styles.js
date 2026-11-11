/*
 * Definição dos estilos musicais.
 * Padrões de bateria: 16 passos por compasso (semicolcheias).
 *   x = forte, o = médio, g = fantasma (fraco), r = rufo (duas batidas), . = pausa
 * Progressões: graus da escala começando em 0 (0 = I, 3 = IV, 4 = V, 5 = vi ...).
 */
(function (global) {
  'use strict';

  const PROG = {
    major: [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 4, 3], [0, 3, 5, 4]],
    minor: [[0, 5, 2, 6], [0, 3, 6, 2], [0, 6, 5, 4], [0, 3, 4, 0], [5, 6, 0, 0]],
  };

  const STYLES = [
    {
      id: 'pop', name: 'Pop', emoji: '🎤',
      keywords: ['pop', 'radio', 'hit', 'kpop', 'k-pop', 'comercial', 'dance pop'],
      bpm: [96, 124], mode: 'major', swing: 0,
      drums: {
        kick:  'x.......x.x.....',
        snare: '....x.......x...',
        hat:   'x.x.x.x.x.x.x.x.',
      },
      bass: 'pop', chords: { inst: 'piano', rhythm: 'pop' }, pad: 'pad',
      lead: 'synthLead', bassInst: 'synthBass', density: 0.55,
    },
    {
      id: 'rock', name: 'Rock', emoji: '🎸',
      keywords: ['rock', 'roqueiro', 'punk', 'grunge', 'indie', 'garagem', 'guitarra distorcida'],
      bpm: [110, 150], mode: 'major', swing: 0,
      drums: {
        kick:  'x.....x.x.......',
        snare: '....x.......x...',
        hat:   'x.x.x.x.x.x.x.x.',
      },
      bass: 'root8', chords: { inst: 'distGuitar', rhythm: 'pulse8', power: true },
      lead: 'leadGuitar', bassInst: 'pickBass', density: 0.5,
      prog: { major: [[0, 4, 5, 3], [0, 3, 4, 3], [0, 6, 3, 0]], minor: [[0, 5, 6, 0], [0, 3, 5, 6]] },
    },
    {
      id: 'metal', name: 'Metal', emoji: '🤘',
      keywords: ['metal', 'heavy', 'heavy metal', 'trash', 'thrash', 'hardcore', 'metaleiro'],
      bpm: [140, 180], mode: 'minor', swing: 0,
      drums: {
        kick:  'xxxxxxxxxxxxxxxx',
        snare: '....x.......x...',
        hat:   'x.x.x.x.x.x.x.x.',
      },
      bass: 'root16', chords: { inst: 'distGuitar', rhythm: 'pulse16', power: true },
      lead: 'leadGuitar', bassInst: 'pickBass', density: 0.6,
      prog: { minor: [[0, 5, 6, 0], [0, 1, 0, 6], [0, 3, 5, 4]], major: [[0, 6, 3, 0]] },
    },
    {
      id: 'samba', name: 'Samba / Pagode', emoji: '🥁',
      keywords: ['samba', 'pagode', 'carnaval', 'batucada', 'escola de samba', 'roda de samba', 'partido alto'],
      bpm: [92, 108], mode: 'major', swing: 0.12, swingUnit: 16,
      drums: {
        kick:  'g...x...g...x..o', // surdo
        rim:   'x.xx.x.x.xx.x.x.', // tamborim
        shaker:'xgoxxgoxxgoxxgox', // pandeiro / ganzá
        snare: '..g..g...g..g..g',
      },
      bass: 'samba', chords: { inst: 'cavaco', rhythm: 'samba', sevenths: true },
      lead: 'flute', bassInst: 'acousticBass', density: 0.6,
      prog: { major: [[0, 5, 1, 4], [0, 3, 1, 4], [3, 4, 0, 5]], minor: [[0, 3, 4, 0], [0, 5, 1, 4]] },
      harmonicV: true,
    },
    {
      id: 'bossa', name: 'Bossa Nova / MPB', emoji: '🌊',
      keywords: ['bossa', 'bossa nova', 'mpb', 'tom jobim', 'ipanema', 'violao e voz', 'barzinho'],
      bpm: [118, 138], mode: 'major', swing: 0,
      drums: {
        kick:  'x..x....x..x....',
        rim:   'x..x..x...x..x..',
        hat:   'gggggggggggggggg',
      },
      bass: 'bossa', chords: { inst: 'nylon', rhythm: 'bossa', sevenths: true },
      lead: 'flute', bassInst: 'acousticBass', density: 0.45,
      prog: { major: [[1, 4, 0, 0], [0, 5, 1, 4], [3, 2, 1, 4]], minor: [[0, 3, 1, 4], [0, 5, 1, 4]] },
      harmonicV: true,
    },
    {
      id: 'forro', name: 'Forró / Baião', emoji: '🪗',
      keywords: ['forro', 'baiao', 'xote', 'xaxado', 'sanfona', 'nordeste', 'nordestino', 'sao joao', 'quadrilha', 'arrasta pe', 'luiz gonzaga', 'zabumba'],
      bpm: [100, 128], mode: 'mixolydian', swing: 0.08, swingUnit: 16,
      drums: {
        kick:  'x..x....x..x....', // zabumba
        snare: '......x.......x.', // bacalhau
        perc:  'xgxxxgxxxgxxxgxx', // triângulo
      },
      bass: 'baiao', chords: { inst: 'accordion', rhythm: 'baiao' },
      lead: 'accordionLead', bassInst: 'acousticBass', density: 0.6,
      prog: { mixolydian: [[0, 6, 0, 4], [0, 3, 6, 0], [0, 0, 3, 4]], major: [[0, 3, 4, 0]], minor: [[0, 3, 0, 4]] },
    },
    {
      id: 'sertanejo', name: 'Sertanejo', emoji: '🤠',
      keywords: ['sertanejo', 'sertaneja', 'modao', 'moda de viola', 'viola caipira', 'caipira', 'country', 'rodeio', 'universitario', 'feminejo'],
      bpm: [80, 100], mode: 'major', swing: 0,
      drums: {
        kick:  'x.......x.......',
        snare: '....x.......x...',
        shaker:'x.x.x.x.x.x.x.x.',
      },
      bass: 'country', chords: { inst: 'steelGuitar', rhythm: 'strum' }, pad: 'strings',
      lead: 'accordionLead', bassInst: 'acousticBass', density: 0.5,
      prog: { major: [[0, 4, 5, 3], [0, 3, 0, 4], [3, 4, 0, 5]], minor: [[0, 5, 6, 4]] },
    },
    {
      id: 'funkbr', name: 'Funk Brasileiro', emoji: '🔊',
      keywords: ['funk', 'baile', 'baile funk', 'funk carioca', 'favela', 'mandelao', 'tamborzao', 'pancadao', 'proibidao'],
      bpm: [128, 135], mode: 'minor', swing: 0,
      drums: {
        kick:  'x..x..x...x..x..',
        clap:  '....x..x....x..x',
        hat:   '..x...x...x...x.',
        perc:  'x.....x...x.....',
      },
      bass: '808', chords: { inst: 'pluck', rhythm: 'stab' },
      lead: 'synthLead', bassInst: 'bass808', density: 0.55,
      prog: { minor: [[0, 0, 5, 6], [0, 6, 5, 6]], major: [[0, 5, 3, 4]] },
    },
    {
      id: 'reggae', name: 'Reggae', emoji: '🇯🇲',
      keywords: ['reggae', 'jamaica', 'bob marley', 'roots', 'ska', 'dub'],
      bpm: [70, 85], mode: 'major', swing: 0.15, swingUnit: 16,
      drums: {
        kick:  '........x.......',
        snare: '........x.......',
        rim:   '........x.......',
        hat:   'x.x.x.x.x.x.x.x.',
      },
      bass: 'reggae', chords: { inst: 'organ', rhythm: 'skank' },
      lead: 'melodica', bassInst: 'synthBass', density: 0.4,
      prog: { major: [[0, 3, 0, 4], [0, 5, 3, 4]], minor: [[0, 3, 0, 3], [0, 6, 5, 6]] },
    },
    {
      id: 'reggaeton', name: 'Reggaeton', emoji: '💃',
      keywords: ['reggaeton', 'regueton', 'latino', 'latina', 'perreo', 'dembow', 'bad bunny'],
      bpm: [88, 98], mode: 'minor', swing: 0,
      drums: {
        kick:  'x...x...x...x...',
        snare: '...x..x....x..x.',
        hat:   'x.x.x.x.x.x.x.x.',
      },
      bass: '808', chords: { inst: 'pluck', rhythm: 'dembow' }, pad: 'pad',
      lead: 'synthLead', bassInst: 'bass808', density: 0.55,
      prog: { minor: [[0, 5, 2, 6], [0, 3, 5, 6]], major: [[5, 3, 0, 4]] },
    },
    {
      id: 'jazz', name: 'Jazz', emoji: '🎷',
      keywords: ['jazz', 'swing', 'bebop', 'big band', 'saxofone', 'sax', 'standard', 'cafe'],
      bpm: [100, 160], mode: 'major', swing: 0.33, swingUnit: 8,
      drums: {
        ride:  'x...x.x.x...x.x.',
        hat:   '....x.......x...',
        kick:  'g.......g.......',
        snare: '..........g....g',
      },
      bass: 'walking', chords: { inst: 'epiano', rhythm: 'comp', sevenths: true },
      lead: 'sax', bassInst: 'acousticBass', density: 0.55,
      prog: { major: [[1, 4, 0, 5], [0, 5, 1, 4], [2, 5, 1, 4]], minor: [[1, 4, 0, 0], [0, 3, 1, 4]] },
      harmonicV: true,
    },
    {
      id: 'blues', name: 'Blues', emoji: '🎺',
      keywords: ['blues', 'shuffle', 'delta', 'b.b. king', 'gaita'],
      bpm: [70, 110], mode: 'major', swing: 0.33, swingUnit: 8,
      drums: {
        kick:  'x.......x.......',
        snare: '....x.......x...',
        hat:   'x.x.x.x.x.x.x.x.',
      },
      bass: 'walking', chords: { inst: 'epiano', rhythm: 'shuffle', dom7: true },
      lead: 'leadGuitar', bassInst: 'acousticBass', density: 0.45,
      prog: { major: [[0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4]], minor: [[0, 0, 0, 0, 3, 3, 0, 0, 5, 4, 0, 4]] },
    },
    {
      id: 'lofi', name: 'Lo-fi / Chill', emoji: '☕',
      keywords: ['lofi', 'lo-fi', 'chill', 'estudar', 'estudo', 'relaxar', 'relaxante', 'chuva', 'beats', 'boom bap'],
      bpm: [72, 88], mode: 'major', swing: 0.22, swingUnit: 16,
      drums: {
        kick:  'x.......x.x.....',
        snare: '....x.......x...',
        hat:   'x.xgx.xgx.xgx.xg',
      },
      bass: 'pop', chords: { inst: 'epiano', rhythm: 'lofi', sevenths: true },
      lead: 'bell', bassInst: 'synthBass', density: 0.35, lofi: true,
      prog: { major: [[3, 2, 1, 0], [1, 4, 0, 5], [3, 4, 2, 5]], minor: [[0, 3, 6, 2], [5, 4, 0, 0]] },
    },
    {
      id: 'trap', name: 'Trap / Hip-Hop', emoji: '🎧',
      keywords: ['trap', 'hip hop', 'hiphop', 'rap', 'drill', 'rima', 'mc', 'freestyle', 'quebrada'],
      bpm: [130, 150], mode: 'minor', swing: 0, halfTime: true,
      drums: {
        kick:  'x......x..x.....',
        snare: '........x.......',
        hat:   'x.x.x.xrx.x.xrrr',
      },
      bass: '808', chords: { inst: 'pad', rhythm: 'block' },
      lead: 'bell', bassInst: 'bass808', density: 0.4,
      prog: { minor: [[0, 0, 5, 6], [0, 2, 5, 4]], major: [[5, 3, 0, 4]] },
    },
    {
      id: 'house', name: 'Eletrônica / House', emoji: '🪩',
      keywords: ['eletronica', 'eletronico', 'house', 'edm', 'balada', 'festa', 'rave', 'dj', 'club', 'dance', 'disco'],
      bpm: [120, 128], mode: 'minor', swing: 0,
      drums: {
        kick:  'x...x...x...x...',
        clap:  '....x.......x...',
        hat:   '..x...x...x...x.',
        shaker:'gggggggggggggggg',
      },
      bass: 'house', chords: { inst: 'pluck', rhythm: 'house' }, pad: 'pad',
      lead: 'synthLead', bassInst: 'synthBass', density: 0.5,
      prog: { minor: [[0, 5, 2, 6], [0, 6, 5, 6]], major: [[0, 4, 5, 3]] },
    },
    {
      id: 'techno', name: 'Techno', emoji: '⚡',
      keywords: ['techno', 'tecno', 'industrial', 'berlim', 'minimal', 'trance', 'psy', 'psytrance'],
      bpm: [128, 138], mode: 'minor', swing: 0,
      drums: {
        kick:  'x...x...x...x...',
        clap:  '....x.......x...',
        hat:   'gxgxgxgxgxgxgxgx',
        perc:  '..x..x....x..x..',
      },
      bass: 'house', chords: { inst: 'pluck', rhythm: 'arp16' }, pad: 'pad',
      lead: 'synthLead', bassInst: 'synthBass', density: 0.3,
      prog: { minor: [[0, 0, 5, 6], [0, 0, 0, 5]], major: [[0, 0, 3, 3]] },
    },
    {
      id: 'gospel', name: 'Gospel / Louvor', emoji: '🙏',
      keywords: ['gospel', 'louvor', 'adoracao', 'igreja', 'deus', 'jesus', 'fe', 'oracao', 'hino', 'worship', 'cristao', 'cristã'],
      bpm: [68, 80], mode: 'major', swing: 0,
      drums: {
        kick:  'x.......x.......',
        snare: '....x.......x...',
        hat:   'x.x.x.x.x.x.x.x.',
      },
      bass: 'pop', chords: { inst: 'piano', rhythm: 'arp' }, pad: 'strings',
      lead: 'flute', bassInst: 'synthBass', density: 0.4,
      prog: { major: [[0, 4, 5, 3], [3, 0, 4, 5], [0, 3, 5, 4]], minor: [[5, 3, 0, 4]] },
    },
    {
      id: 'balada', name: 'Balada Romântica', emoji: '💖',
      keywords: ['balada', 'romantica', 'romantico', 'amor', 'paixao', 'coracao', 'love', 'saudade', 'casamento'],
      bpm: [66, 80], mode: 'major', swing: 0,
      drums: {
        kick:  'x.......x.......',
        snare: '....x.......x...',
        hat:   'x.x.x.x.x.x.x.x.',
      },
      bass: 'pop', chords: { inst: 'piano', rhythm: 'arp' }, pad: 'strings',
      lead: 'violin', bassInst: 'synthBass', density: 0.4,
      prog: { major: [[0, 4, 5, 3], [0, 5, 3, 4], [3, 4, 2, 5]], minor: [[0, 5, 3, 4]] },
    },
    {
      id: 'classica', name: 'Clássica / Orquestral', emoji: '🎻',
      keywords: ['classica', 'classico', 'orquestra', 'orquestral', 'sinfonia', 'piano solo', 'mozart', 'bach', 'beethoven', 'cinema', 'trilha', 'epico', 'epica', 'filme'],
      bpm: [70, 100], mode: 'minor', swing: 0, noDrums: true,
      drums: {},
      bass: 'half', chords: { inst: 'piano', rhythm: 'alberti' }, pad: 'strings',
      lead: 'violin', bassInst: 'cello', density: 0.5,
      prog: { minor: [[0, 3, 4, 0], [0, 5, 3, 4], [0, 6, 2, 5]], major: [[0, 3, 4, 0], [0, 5, 1, 4]] },
      harmonicV: true,
    },
    {
      id: 'ambient', name: 'Ambiente / Meditação', emoji: '🌌',
      keywords: ['ambiente', 'ambient', 'meditacao', 'meditar', 'dormir', 'sono', 'espaco', 'yoga', 'paz', 'natureza', 'calmaria'],
      bpm: [60, 72], mode: 'major', swing: 0, noDrums: true,
      drums: {},
      bass: 'whole', chords: { inst: 'pad', rhythm: 'block' }, pad: 'strings',
      lead: 'bell', bassInst: 'synthBass', density: 0.2,
      prog: { major: [[0, 3, 0, 3], [0, 5, 3, 3]], minor: [[0, 5, 0, 3]] },
    },
  ];

  const BY_ID = {};
  STYLES.forEach((s) => { BY_ID[s.id] = s; });

  function getProgressions(style, mode) {
    const p = style.prog && style.prog[mode];
    if (p && p.length) return p;
    return PROG[mode === 'minor' || mode === 'dorian' ? 'minor' : 'major'];
  }

  global.STYLES = { list: STYLES, byId: BY_ID, getProgressions };
})(window);

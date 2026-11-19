/* Interface: abas, gravação, geração, reprodução, mixer, visualização e download. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const EXAMPLES = [
    'Samba alegre sobre o verão no Rio, com flauta',
    'Forró animado de São João com sanfona',
    'Lo-fi calmo para estudar numa tarde de chuva',
    'Rock energético sobre liberdade na estrada',
    'Balada romântica triste sobre saudade, com piano',
    'Bossa nova suave em Ré maior, 126 bpm',
    'Funk brasileiro pesado para o baile',
    'Trilha épica orquestral de batalha',
    'Sertanejo apaixonado com violão',
    'House para festa na praia',
    'Louvor de adoração com piano e cordas',
    'Jazz com saxofone num café à noite',
  ];

  const MOOD_PT = { triste: 'triste', alegre: 'alegre', calmo: 'calmo', energetico: 'energético', romantico: 'romântico', misterioso: 'misterioso', epico: 'épico' };

  const STEM_INFO = {
    drums: { label: 'Bateria', color: '#f2a93b' },
    bass: { label: 'Baixo', color: '#2bb39a' },
    harmony: { label: 'Harmonia', color: '#4d8fe0' },
    melody: { label: 'Melodia', color: '#e0492f' },
    voice: { label: 'Sua voz', color: '#9b6bdf' },
    music: { label: 'Música (IA)', color: '#e0492f' },
  };

  const state = {
    tab: 'texto',
    song: null, render: null, variation: 0,
    voiceBuffer: null, voiceNotes: null,
    gains: { drums: 0.9, bass: 0.9, harmony: 0.8, melody: 0.9, voice: 1, music: 1 },
    ctx: null, sources: [], gainNodes: {}, playing: false, startAt: 0, offset: 0,
    raf: 0,
  };

  /* ---------------- inicialização ---------------- */

  /* ---------------- visual "app de música" ---------------- */

  const QUICK_STYLES = [['rock', 'Rock'], ['samba', 'Samba'], ['forro', 'Forró'], ['pop', 'Pop'], ['sertanejo', 'Sertanejo'],
    ['funkbr', 'Funk'], ['gospel', 'Gospel'], ['lofi', 'Lo-fi'], ['reggae', 'Reggae'], ['trap', 'Trap'], ['bossa', 'Bossa nova'], ['balada', 'Balada']];
  const COVER = {
    rock: ['#ff5a36', '#3b0d0d'], metal: ['#8a8a8a', '#120c0c'], samba: ['#ffcf3f', '#e8501f'], bossa: ['#3fb6c9', '#16324f'],
    forro: ['#ffb547', '#b5482a'], sertanejo: ['#e9a65b', '#5b3a1f'], funkbr: ['#ff3fa4', '#2b0a3d'], reggae: ['#3ccf6d', '#d9a21b'],
    reggaeton: ['#ff6a3d', '#5a1a7a'], jazz: ['#c99a4a', '#1f1a33'], blues: ['#3f6bff', '#0d1640'], lofi: ['#c8a2ff', '#2e2a4f'],
    trap: ['#7a3cff', '#0b0b12'], house: ['#00d0ff', '#4b1aff'], techno: ['#9cff57', '#0f1f0f'], gospel: ['#ffe08a', '#c06a2b'],
    balada: ['#ff7a9c', '#4a1630'], classica: ['#d9c7a3', '#3a2f22'], ambient: ['#7fd7ff', '#1d2b4a'], pop: ['#ff7a45', '#7a3cff'],
  };

  function initLook() {
    const box = $('styleChips');
    QUICK_STYLES.forEach(([id, label]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'style-chip'; b.textContent = label;
      b.setAttribute('aria-pressed', 'false');
      b.onclick = () => {
        const on = $('styleSel').value !== id;
        $('styleSel').value = on ? id : 'auto';
        syncStyleChips();
      };
      b.dataset.style = id;
      box.appendChild(b);
    });
    $('styleSel').addEventListener('change', syncStyleChips);
    const drawer = (btn, panel) => {
      $(btn).onclick = () => {
        const open = $(panel).classList.contains('hidden');
        $(panel).classList.toggle('hidden', !open);
        $(btn).setAttribute('aria-expanded', open);
      };
    };
    drawer('openVoice', 'voicePanel');
    drawer('openAdv', 'advPanel');
  }

  function syncStyleChips() {
    if (typeof metroPreview !== 'undefined' && metroPreview) { metroPreview.stop(); metroPreview = null; $('btnMetroTest').textContent = '▶ Ouvir a marcação'; }
    document.querySelectorAll('.style-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.style === $('styleSel').value)));
  }

  function paintCover(song) {
    const c = COVER[song.style.id] || COVER.pop;
    $('cover').style.background = 'radial-gradient(circle at 30% 25%, rgba(255,255,255,.25), transparent 45%), linear-gradient(135deg, ' + c[0] + ', ' + c[1] + ')';
    $('coverEmoji').textContent = song.style.emoji || '🎵';
  }

  function init() {
    initLook();
    initRhythm();
    initEngine();
    initCloneAi();
    if (window.claude) $('envNote').classList.remove('hidden'); // página publicada no Claude
    const ex = $('examples');
    EXAMPLES.forEach((t) => {
      const b = document.createElement('button');
      b.className = 'chip'; b.type = 'button'; b.textContent = t;
      b.onclick = () => { $('prompt').value = t; $('prompt').focus(); };
      ex.appendChild(b);
    });
    const ss = $('styleSel');
    STYLES.list.forEach((s) => ss.add(new Option(s.emoji + ' ' + s.name, s.id)));
    const ks = $('keySel');
    MT.NOTE_PT.forEach((n, i) => ks.add(new Option(n, String(i))));

    document.querySelectorAll('.tab').forEach((t) => {
      t.onclick = () => switchTab(t.dataset.tab);
    });
    $('bpmIn').oninput = () => {
      const v = +$('bpmIn').value;
      $('bpmLabel').textContent = v < 50 ? 'automático' : v + ' bpm';
    };
    $('btnGen').onclick = () => generate(false);
    $('btnAgain').onclick = () => generate(true);
    $('btnRec').onclick = toggleRecord;
    $('fileIn').onchange = (e) => { if (e.target.files[0]) loadVoiceFile(e.target.files[0]); };
    $('btnPlay').onclick = togglePlay;
    $('btnStop').onclick = () => { stop(); state.offset = 0; drawRoll(); updateTime(); };
    $('seek').oninput = () => {
      if (!state.render) return;
      const pos = (+$('seek').value / 1000) * state.render.duration;
      seekTo(pos);
    };
    $('roll').onclick = (e) => {
      if (!state.render) return;
      const r = e.target.getBoundingClientRect();
      seekTo(((e.clientX - r.left) / r.width) * state.render.duration);
    };
    $('btnDownload').onclick = downloadSelected;
    $('fmtSel').onchange = updateSizeHint;
    window.addEventListener('resize', drawRoll);
    $('btnLyricsExample').onclick = () => {
      $('lyrics').value = 'Olha o sol nascendo lá no mar\nVem comigo, vem dançar\nA onda chega devagar\nE o coração quer cantar\n\nÉ verão, é verão no meu coração\nBatucando sem parar\nÉ verão, é verão, me dá sua mão\nVem comigo festejar';
      $('lyrics').focus();
    };
    let lyricsTouched = false;
    $('lyrics').addEventListener('input', () => {
      // na aba de voz, ao escrever uma letra, a gravação original sai da mixagem (para não cantar duas vezes)
      if (state.tab === 'voz' && !lyricsTouched && $('lyrics').value.trim()) { $('includeVoice').checked = false; lyricsTouched = true; }
    });
    $('lenSel').onchange = () => $('minutesWrap').classList.toggle('hidden', $('lenSel').value !== 'custom');
    $('btnClone').onclick = startClone;
    $('btnCancelClone').onclick = () => { if (cloneRec) { cloneRec.cancelled = true; cloneRec.mr.stop(); } };
    $('btnDemo').onclick = playDemo;
    $('cloneFileIn').onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      $('cloneStatus').textContent = '⏳ Analisando o timbre da sua voz…';
      try {
        const buf = await audioCtx().decodeAudioData(await file.arrayBuffer());
        const p = await VoiceClone.profileFromFreeRecording(buf);
        await saveClone(p);
        $('cloneUploadBox').open = false;
      } catch (err) {
        console.error(err);
        $('cloneStatus').textContent = '⚠️ ' + (err.message || 'Não consegui ler esse áudio.') + ' Grave de novo seguindo os passos abaixo.';
      }
    };
    let delArmed = 0;
    $('btnDelClone').onclick = async () => {
      // confirmação na própria página: o 1º clique pede, o 2º apaga
      if (Date.now() - delArmed > 4000) {
        delArmed = Date.now();
        $('btnDelClone').textContent = '⚠️ Clique de novo para apagar';
        setTimeout(() => { if (Date.now() - delArmed >= 4000) $('btnDelClone').textContent = '🗑 Apagar'; }, 4100);
        return;
      }
      delArmed = 0;
      $('btnDelClone').textContent = '🗑 Apagar';
      try { await VoiceClone.deleteProfile(); } catch (e) { /* armazenamento indisponível */ }
      state.cloneProfile = null;
      updateCloneUI();
    };
    VoiceClone.loadProfile().then((p) => {
      state.cloneProfile = p;
      updateCloneUI();
      if (p) $('singerSel').value = 'clone';
    });
  }

  /* ---------------- clonagem de voz ---------------- */

  let cloneRec = null;
  const VOWEL_HINT = { a: 'A — “aaaa”', e: 'É — “éééé”', i: 'I — “iiii”', o: 'Ó — “óóóó”', u: 'U — “uuuu”' };

  function singerProfile() {
    const v = $('singerSel').value;
    if (v === 'clone' && state.cloneProfile) return state.cloneProfile;
    return VoiceClone.syntheticProfile(v === 'masc' ? 'masc' : 'fem');
  }

  function updateCloneUI() {
    const p = state.cloneProfile;
    const opt = $('singerSel').querySelector('option[value=clone]');
    opt.disabled = !p;
    opt.textContent = p ? 'Minha voz clonada' : 'Minha voz (clone antes)';
    $('openVoice').textContent = p ? '🧬 Minha voz' : '🧬 Clonar voz';
    if (!p && $('singerSel').value === 'clone') $('singerSel').value = 'fem';
    $('btnDelClone').classList.toggle('hidden', !p);
    $('btnClone').textContent = p ? '🔁 Clonar de novo' : '🧬 Clonar minha voz';
    $('cloneStatus').innerHTML = p
      ? '✅ <b>Voz clonada</b> em ' + new Date(p.created).toLocaleDateString('pt-BR') + ' · tom natural: ' + MT.midiToName(p.midi, true)
      : 'Nenhuma voz clonada ainda. Leva ~15 segundos: você canta as 5 vogais.';
  }

  async function startClone() {
    if (cloneRec) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      $('cloneStatus').textContent = '⚠️ ' + micHelp(e);
      return;
    }
    stop();
    const V = VoiceClone.VOWELS, SEG = VoiceClone.SEG_SEC, LEAD = VoiceClone.LEAD_IN;
    const totalSec = LEAD + V.length * SEG + 0.3;
    $('cloneWizard').classList.remove('hidden');
    $('btnClone').disabled = true;
    $('vowelRow').innerHTML = V.map((v) => '<span>' + v.toUpperCase() + '</span>').join('');
    const spans = $('vowelRow').querySelectorAll('span');
    const mr = new MediaRecorder(stream);
    const chunks = [];
    cloneRec = { mr, cancelled: false };
    let t0 = 0, raf = 0;
    const tick = () => {
      const s = t0 ? (performance.now() - t0) / 1000 : 0;
      $('cloneProgress').style.width = Math.min(100, (s / totalSec) * 100) + '%';
      const i = Math.floor((s - LEAD) / SEG);
      if (s < LEAD) $('bigVowel').textContent = 'Prepare-se…';
      else if (i < V.length) $('bigVowel').textContent = VOWEL_HINT[V[i]];
      else $('bigVowel').textContent = 'Pronto!';
      spans.forEach((sp, k) => { sp.className = k < i ? 'ok' : k === i ? 'now' : ''; });
      if (s >= totalSec && mr.state === 'recording') mr.stop();
      raf = requestAnimationFrame(tick);
    };
    mr.onstart = () => { t0 = performance.now(); };
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      const cancelled = cloneRec.cancelled;
      cloneRec = null;
      $('btnClone').disabled = false;
      $('cloneWizard').classList.add('hidden');
      if (cancelled) return;
      $('cloneStatus').textContent = '⏳ Analisando o timbre da sua voz…';
      try {
        const buf = await audioCtx().decodeAudioData(await new Blob(chunks, { type: mr.mimeType || 'audio/webm' }).arrayBuffer());
        await useCloneRecording(buf);
      } catch (e) {
        console.error(e);
        $('cloneStatus').textContent = '⚠️ ' + (e.message || 'Não deu certo.') + ' Tente de novo, cantando cada vogal sem parar e um pouco mais alto.';
      }
    };
    mr.start();
    tick();
  }

  async function useCloneRecording(buffer) {
    return saveClone(await VoiceClone.profileFromGuidedRecording(buffer));
  }

  async function saveClone(p) {
    try { await VoiceClone.saveProfile(p); } catch (e) { console.warn('não foi possível salvar', e); }
    state.cloneProfile = p;
    updateCloneUI();
    $('singerSel').value = 'clone';
    playDemo();
    return p;
  }

  function playDemo() {
    try {
      const buf = VoiceClone.demo(singerProfile());
      const ctx = audioCtx();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
    } catch (e) {
      console.error(e);
    }
  }

  function switchTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.tab === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
    });
    $('panel-texto').classList.toggle('hidden', tab !== 'texto');
    $('panel-voz').classList.toggle('hidden', tab !== 'voz');
    $('lyricsHint').innerHTML = tab === 'voz'
      ? 'Escreva a letra que combina com a melodia que você cantou. As sílabas são encaixadas, em ordem, nas notas detectadas, e a voz escolhida abaixo canta a letra.'
      : 'Escreva a letra aqui, uma frase por linha. Deixe uma <b>linha em branco</b> entre o verso e o refrão. A melodia vai seguir as sílabas da letra.';
  }

  function setStatus(msg, err) {
    const s = $('status');
    s.textContent = msg || '';
    s.classList.toggle('err', !!err);
  }

  function audioCtx() {
    if (!state.ctx) state.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (state.ctx.state === 'suspended') state.ctx.resume();
    return state.ctx;
  }

  /* Explica por que o microfone falhou e o que fazer. */
  function micHelp(e) {
    if (window.claude) return 'Nesta versão de teste o microfone fica bloqueado. Use o site completo (souzaramyewe-hub.github.io/Ramyeve) ou “Enviar áudio”.';
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') {
      return 'O microfone está bloqueado para este site. Clique no ícone à esquerda do endereço (barra do navegador) → Microfone → Permitir, e recarregue a página. Se não resolver, no Windows abra Configurações → Privacidade e segurança → Microfone e ligue o acesso.';
    }
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Nenhum microfone foi encontrado neste aparelho. Conecte um fone com microfone ou grave no celular e use “Enviar áudio”.';
    if (n === 'NotReadableError') return 'O microfone está sendo usado por outro programa (ex.: Meet, WhatsApp). Feche a chamada e tente de novo.';
    return 'Não foi possível usar o microfone. Grave no celular e use “Enviar áudio”.';
  }

  /* ---------------- voz real com IA (Seed-VC) ---------------- */

  function currentToken() { return ($('hfToken').value || $('hfToken2').value || '').trim(); }

  /* qualquer áudio -> WAV mono 22 kHz (até 30 s), formato que o servidor aceita bem */
  async function toWavBlob(buffer, maxSec) {
    const sr = 22050;
    const len = Math.ceil(Math.min(buffer.duration, maxSec || 1e9) * sr);
    const ctx = new OfflineAudioContext(1, Math.max(1, len), sr);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start();
    const out = await ctx.startRendering();
    const L = out.getChannelData(0);
    return Formats.wav({ L, R: L, sr }, 16);
  }

  async function setRef(blobOrFile) {
    const buf = await audioCtx().decodeAudioData(await blobOrFile.arrayBuffer());
    if (buf.duration < 5) throw new Error('A amostra ficou curta (' + buf.duration.toFixed(0) + ' s). Grave pelo menos 10 segundos.');
    const wav = await toWavBlob(buf, 30);
    state.refBlob = wav;
    try { await VoiceClone.saveRef(wav); } catch (e) { /* sem armazenamento */ }
    updateRefUI(Math.min(30, buf.duration));
  }

  function updateRefUI(sec) {
    const has = !!state.refBlob;
    $('btnRefDel').classList.toggle('hidden', !has);
    $('refPreview').classList.toggle('hidden', !has);
    if (has) $('refPreview').src = URL.createObjectURL(state.refBlob);
    $('refStatus').textContent = has ? '✅ Amostra da sua voz guardada' + (sec ? ' (' + Math.round(sec) + ' s)' : '') + '. Marque a opção abaixo para usar.' : 'Nenhuma amostra da sua voz ainda.';
    if (has && AIMusic.available() && sec) { $('cloneAi').checked = true; syncCloneAi(); }
  }

  function syncCloneAi() {
    $('hfBox2').classList.toggle('hidden', !$('cloneAi').checked);
    // lembra a escolha em todos os caminhos (clique ou marcação automática após gravar a amostra)
    try { localStorage.setItem('ramyeve-clone-ai', $('cloneAi').checked ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
    if ($('cloneAi').checked && !state.refBlob) $('refStatus').textContent = '👆 Primeiro grave ou envie uma amostra da sua voz.';
  }

  let refRec = null;
  async function recordRef() {
    if (refRec) { refRec.stop(); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      $('refStatus').textContent = '⚠️ ' + micHelp(e);
      return;
    }
    const mr = new MediaRecorder(stream);
    const chunks = [];
    const t0 = performance.now();
    const timer = setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      $('btnRefRec').textContent = '■ Parar (' + Math.max(0, Math.ceil(20 - s)) + ' s)';
      if (s >= 20 && mr.state === 'recording') mr.stop();
    }, 200);
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      refRec = null;
      $('btnRefRec').classList.remove('rec', 'on');
      $('btnRefRec').textContent = '🎙️ Gravar minha voz (20 s)';
      try { await setRef(new Blob(chunks, { type: mr.mimeType || 'audio/webm' })); } catch (e) { $('refStatus').textContent = '⚠️ ' + e.message; }
    };
    mr.start();
    refRec = mr;
    $('btnRefRec').classList.add('rec', 'on');
    $('refStatus').textContent = '🔴 Gravando… cante ou fale com naturalidade, perto do microfone.';
  }

  function initCloneAi() {
    $('btnRefRec').onclick = recordRef;
    $('refFileIn').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      $('refStatus').textContent = '⏳ Lendo o áudio…';
      try { await setRef(f); } catch (err) { $('refStatus').textContent = '⚠️ ' + (err.message || 'Não consegui ler esse áudio.'); }
    };
    $('btnRefDel').onclick = async () => {
      try { await VoiceClone.deleteRef(); } catch (e) { /* ok */ }
      state.refBlob = null; $('cloneAi').checked = false; syncCloneAi(); updateRefUI();
    };
    $('cloneAi').onchange = syncCloneAi;
    // a chave é a mesma nos dois lugares
    const mirror = (a, b) => $(a).addEventListener('input', () => { $(b).value = $(a).value; });
    mirror('hfToken', 'hfToken2'); mirror('hfToken2', 'hfToken');
    $('hfToken2').value = $('hfToken').value;
    if (!AIMusic.available()) { $('cloneAi').disabled = true; $('cloneAiBlocked').classList.remove('hidden'); }
    let wasOn = false;
    try { wasOn = localStorage.getItem('ramyeve-clone-ai') === '1'; } catch (e) { /* sem armazenamento */ }
    showKeyState();
    VoiceClone.loadRef().then((b) => {
      if (b) { state.refBlob = b; updateRefUI(); }
      if (wasOn && AIMusic.available()) { $('cloneAi').checked = true; syncCloneAi(); }
    });
  }

  function rememberToken(token) {
    try { if ($('hfRemember').checked) localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* sem armazenamento */ }
  }

  /* ---------------- ritmo e metrônomo (aba Cantar) ---------------- */

  const taps = [];
  let metroPreview = null;

  function voiceBpm() { return Math.max(50, Math.min(200, Math.round(parseFloat($('voiceBpm').value) || 100))); }

  function syncRhythm() {
    const metro = $('metroOn').checked, man = $('rhythmManual').checked;
    $('voiceBpm').disabled = !(metro || man);
    $('bpmMinus').disabled = $('bpmPlus').disabled = !(metro || man);
    $('rhythmInfo').textContent = metro ? 'marcação a ' + voiceBpm() + ' bpm' : man ? voiceBpm() + ' bpm (marcado por você)' : 'detectado sozinho';
    if (metroPreview) { metroPreview.stop(); metroPreview = null; $('btnMetroTest').textContent = '▶ Ouvir a marcação'; }
  }

  /* "tique" do metrônomo: mais agudo no 1º tempo de cada compasso */
  function click(ctx, time, accent) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 1760 : 1175;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.22, time + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    o.connect(g).connect(ctx.destination);
    o.start(time); o.stop(time + 0.06);
  }

  /* estilo usado para a batida: o escolhido nos botões de ritmo (ou pop) */
  function grooveStyle() {
    const id = $('styleSel').value;
    const st = STYLES.byId[id !== 'auto' ? id : 'pop'];
    return st && !st.noDrums ? st : null;
  }
  const VEL = { x: 1, o: 0.7, g: 0.4, r: 0.75 };

  /*
   * Metrônomo com agendamento antecipado (não atrasa mesmo com a página ocupada).
   * opts.countIn: quantas batidas só de "tique" antes; opts.groove: estilo cuja bateria
   * toca depois da contagem (em vez do tique).
   */
  function startMetro(bpm, startAt, onBeat, opts) {
    opts = opts || {};
    const ctx = audioCtx();
    const beat = 60 / bpm, step = beat / 4;
    const countIn = opts.countIn || 0;
    const groove = opts.groove && window.Sampler ? opts.groove : null;
    const out = ctx.createGain(); out.gain.value = 0.7; out.connect(ctx.destination);
    let i = 0;            // batidas (para a contagem e o aviso na tela)
    let s16 = 0;          // semicolcheias da batida, depois da contagem
    const grooveStart = startAt + countIn * beat;
    const timers = [];
    const schedule = () => {
      const horizon = ctx.currentTime + 0.2;
      while (startAt + i * beat < horizon) {
        const when = startAt + i * beat;
        if (!groove || i < countIn) click(ctx, when, i % 4 === 0);
        if (onBeat) { const k = i; timers.push(setTimeout(() => onBeat(k), Math.max(0, (when - ctx.currentTime) * 1000))); }
        i++;
      }
      if (groove) {
        while (grooveStart + s16 * step < horizon) {
          const when = grooveStart + s16 * step;
          for (const [lane, pat] of Object.entries(groove.drums)) {
            const ch = pat[s16 % 16];
            if (!ch || ch === '.') continue;
            if (!Sampler.playDrum(ctx, out, when, lane, VEL[ch] || 1, groove) && lane === 'kick') click(ctx, when, true);
          }
          s16++;
        }
      }
    };
    schedule();
    const id = setInterval(schedule, 25);
    return { stop() { clearInterval(id); timers.forEach(clearTimeout); setTimeout(() => out.disconnect(), 400); } };
  }

  /* prepara a bateria do ritmo escolhido (se a marcação for a batida) */
  async function grooveForRecording() {
    if ($('metroSound').value !== 'beat') return null;
    const st = grooveStyle();
    if (!st || !window.Sampler) return null;
    try { await Sampler.ensureKit(st); } catch (e) { /* usa o tique */ }
    return st;
  }

  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    click(audioCtx(), audioCtx().currentTime, false);
    $('btnTap').classList.add('hit');
    setTimeout(() => $('btnTap').classList.remove('hit'), 90);
    if (taps.length < 2) { $('rhythmInfo').textContent = 'continue tocando no ritmo…'; return; }
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    let bpm = 60000 / avg;
    while (bpm < 50) bpm *= 2;
    while (bpm > 200) bpm /= 2;
    $('voiceBpm').value = Math.round(bpm);
    $('rhythmManual').checked = true;
    syncRhythm();
  }

  function initRhythm() {
    $('btnTap').addEventListener('pointerdown', (e) => { e.preventDefault(); tap(); });
    $('btnTap').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
    $('bpmMinus').onclick = () => { $('voiceBpm').value = voiceBpm() - 1; syncRhythm(); };
    $('bpmPlus').onclick = () => { $('voiceBpm').value = voiceBpm() + 1; syncRhythm(); };
    $('voiceBpm').addEventListener('change', () => { $('voiceBpm').value = voiceBpm(); syncRhythm(); });
    $('rhythmManual').onchange = syncRhythm;
    $('metroOn').onchange = syncRhythm;
    $('btnMetroTest').onclick = () => {
      if (metroPreview) { metroPreview.stop(); metroPreview = null; $('btnMetroTest').textContent = '▶ Ouvir a marcação'; return; }
      $('btnMetroTest').disabled = true;
      grooveForRecording().then((st) => {
        $('btnMetroTest').disabled = false;
        metroPreview = startMetro(voiceBpm(), audioCtx().currentTime + 0.05, null, { groove: st });
        $('btnMetroTest').textContent = '■ Parar a marcação';
      });
    };
    syncRhythm();
  }

  /* ---------------- gravação de voz ---------------- */

  let rec = null;

  async function toggleRecord() {
    if (rec) { rec.stop(); return; }
    // a bateria do ritmo escolhido precisa estar pronta antes da contagem
    const groovePrepared = $('metroOn').checked ? await grooveForRecording() : null;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setStatus(micHelp(e), true);
      return;
    }
    const ctx = audioCtx();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    const srcNode = ctx.createMediaStreamSource(stream);
    srcNode.connect(an);
    const mr = new MediaRecorder(stream);
    const chunks = [];
    const t0 = performance.now();
    const data = new Float32Array(an.fftSize);
    let raf = 0;
    const tick = () => {
      an.getFloatTimeDomainData(data);
      let e = 0; for (const x of data) e += x * x;
      $('meterBar').style.width = Math.min(100, Math.sqrt(e / data.length) * 400) + '%';
      const s = (performance.now() - t0) / 1000;
      $('recTime').textContent = fmt(s);
      raf = requestAnimationFrame(tick);
    };
    // metrônomo: 4 batidas de contagem e depois continua marcando o ritmo
    let metro = null, grid = null, recStartCtx = null;
    if (metroPreview) { metroPreview.stop(); metroPreview = null; $('btnMetroTest').textContent = '▶ Ouvir a marcação'; }
    const useMetro = $('metroOn').checked;
    const bpm = voiceBpm();
    const metroStart = ctx.currentTime + 0.3;
    mr.onstart = () => { recStartCtx = ctx.currentTime; };
    if (useMetro) {
      $('countIn').classList.remove('hidden');
      metro = startMetro(bpm, metroStart, (k) => {
        if (k < 4) $('countIn').textContent = String(k + 1);
        else if (k === 4) { $('countIn').textContent = '🎤 Cante!'; setStatus('Gravando… cante no ritmo e clique em Parar.'); }
        else if (k === 8) $('countIn').classList.add('hidden');
      }, { countIn: 4, groove: groovePrepared });
    }
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      if (metro) metro.stop();
      $('countIn').classList.add('hidden');
      // grade do ritmo na linha do tempo da gravação: o "1" vem depois das 4 batidas de contagem
      if (useMetro && recStartCtx != null) grid = { bpm, offset: Math.max(0, metroStart - recStartCtx) + 4 * 60 / bpm };
      state.nextGrid = grid;
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      srcNode.disconnect();
      $('meterBar').style.width = '0';
      $('btnRec').classList.remove('on');
      $('btnRec').textContent = '● Gravar';
      rec = null;
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      await loadVoiceBlob(blob);
    };
    mr.start();
    rec = mr;
    tick();
    $('btnRec').classList.add('on');
    $('btnRec').textContent = '■ Parar';
    setStatus(useMetro ? 'Ouça a contagem: 1, 2, 3, 4… e cante!' : 'Gravando… cante sua melodia e clique em Parar.');
  }

  async function loadVoiceFile(file) {
    await loadVoiceBlob(file);
  }

  async function loadVoiceBlob(blob) {
    try {
      setStatus('Analisando as notas da sua voz…');
      $('recPreview').src = URL.createObjectURL(blob);
      $('recPreview').classList.remove('hidden');
      const ctx = audioCtx();
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      await setVoice(buf); // sem limite de duração
    } catch (e) {
      console.error(e);
      setStatus('Não consegui ler esse áudio. Tente outro arquivo (mp3, wav, m4a, ogg).', true);
    }
  }

  async function setVoice(buffer) {
    state.voiceGrid = state.nextGrid || null; // áudio enviado por arquivo não tem grade
    state.nextGrid = null;
    const res = await Pitch.analyze(buffer, (p) => setStatus('Analisando as notas da sua voz… ' + Math.round(p * 100) + '%'));
    state.voiceBuffer = buffer;
    state.voiceNotes = res.notes;
    const info = $('voiceInfo');
    info.classList.remove('hidden');
    if (!res.notes.length) {
      info.textContent = 'Nenhuma nota clara foi encontrada. Tente cantar mais alto, mais perto do microfone, sem música de fundo.';
      setStatus('');
      return res;
    }
    const k = MT.detectKey(res.notes);
    const preview = res.notes.slice(0, 14).map((n) => MT.midiToName(n.midi, true)).join(' · ');
    info.innerHTML = '<b>' + res.notes.length + ' notas detectadas</b> · tom provável: <b>' + MT.keyName(k.key, k.mode) +
      '</b><br><span class="muted">' + preview + (res.notes.length > 14 ? ' …' : '') + '</span>';
    setStatus('Pronto! Escolha o estilo e clique em “Gerar música”.');
    return res;
  }

  /* ---------------- modo IA (ACE-Step) ---------------- */

  const TOKEN_KEY = 'ramyeve-hf-token';
  function engine() { return $('engAi').checked && AIMusic.available() ? 'ai' : 'fast'; }

  function initEngine() {
    const sync = () => $('aiBox').classList.toggle('hidden', !$('engAi').checked);
    $('engFast').onchange = sync;
    $('engAi').onchange = sync;
    if (!AIMusic.available()) {
      $('engAi').disabled = true;
      $('aiBlocked').classList.remove('hidden');
    }
    try { const t = localStorage.getItem(TOKEN_KEY); if (t) $('hfToken').value = t; } catch (e) { /* sem armazenamento */ }
    ['hfToken', 'hfToken2'].forEach((id) => $(id).addEventListener('blur', () => { $(id).value = $(id).value.trim(); }));
    const saveToken = () => {
      const t = currentToken();
      try {
        if ($('hfRemember').checked && /^hf_/.test(t)) localStorage.setItem(TOKEN_KEY, t);
        if (!$('hfRemember').checked) localStorage.removeItem(TOKEN_KEY);
      } catch (e) { /* sem armazenamento */ }
      showKeyState();
    };
    ['hfToken', 'hfToken2'].forEach((id) => $(id).addEventListener('input', () => setTimeout(saveToken, 0)));
    $('hfRemember').addEventListener('change', saveToken);
  }

  /* mostra se a chave está guardada neste aparelho */
  function showKeyState() {
    let saved = '';
    try { saved = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { /* sem armazenamento */ }
    const t = currentToken();
    let msg = '';
    if (t && !/^hf_/.test(t)) msg = '⚠️ A chave deve começar com hf_. Confira se colou a chave inteira.';
    else if (saved && saved === t) msg = '✅ Chave guardada neste aparelho. Não precisa colar de novo.';
    else if (t) msg = 'Chave colada (não será lembrada: “Lembrar neste aparelho” está desmarcado).';
    document.querySelectorAll('[data-key-state]').forEach((el) => { el.textContent = msg; el.style.color = /^⚠️/.test(msg) ? '#ff8a8a' : ''; });
  }

  async function generateAI(song) {
    if (state.tab !== 'texto') {
      setStatus('O modo IA funciona na aba “Por texto”. Para usar sua melodia gravada, escolha “Rápido, no navegador”.', true);
      return song;
    }
    const token = $('hfToken').value.trim();
    if (!/^hf_/.test(token)) {
      setStatus('Cole sua chave grátis do Hugging Face (começa com hf_). Veja “Como conseguir a chave grátis”.', true);
      $('hfToken').focus();
      return song;
    }
    try {
      if ($('hfRemember').checked) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* sem armazenamento */ }
    const singer = $('singerSel').value === 'masc' ? 'masc' : 'fem';
    const duration = Math.min(240, Math.max(20, Synth.stepToTime(song, song.totalBars * 16)));
    $('btnGen').disabled = $('btnAgain').disabled = true;
    try {
      const buf = await AIMusic.generate({
        tags: AIMusic.buildTags(song, singer),
        lyrics: AIMusic.buildLyrics($('lyrics').value),
        duration, token, onStatus: (t) => setStatus(t),
      });
      const st = new AudioBuffer({ numberOfChannels: 2, length: buf.length, sampleRate: buf.sampleRate });
      st.copyToChannel(buf.getChannelData(0), 0);
      st.copyToChannel(buf.getChannelData(buf.numberOfChannels > 1 ? 1 : 0), 1);
      song.singer = singer === 'masc' ? 'Voz de IA masculina' : 'Voz de IA feminina';
      state.song = song;
      state.render = { stems: { music: st }, duration: buf.duration, sampleRate: buf.sampleRate, hasVoice: false, ai: true };
      state.offset = 0;
      showResult();
      setStatus('');
      play();
    } catch (e) {
      console.error(e);
      setStatus(e.message || 'Não foi possível gerar com a IA.', true);
    } finally {
      $('btnGen').disabled = $('btnAgain').disabled = false;
    }
    return song;
  }

  /* ---------------- geração ---------------- */

  async function generate(again) {
    stop();
    state.variation = again ? state.variation + 1 : 0;
    const bpmV = +$('bpmIn').value;
    const common = {
      styleId: $('styleSel').value,
      key: $('keySel').value,
      mode: $('modeSel').value,
      bpm: bpmV >= 50 ? bpmV : null,
      length: $('lenSel').value,
      minutes: parseFloat(String($('minutesIn').value).replace(',', '.')) || 3,
      variation: state.variation,
    };
    let song;
    try {
      if (state.tab === 'texto') {
        const prompt = $('prompt').value.trim();
        const lyrics = $('lyrics').value.trim();
        if (!prompt && !lyrics) { setStatus('Escreva uma descrição (ou uma letra) para criar a música.', true); return; }
        song = Composer.composeFromText(Object.assign({ prompt, lyrics }, common));
      } else {
        if (!state.voiceNotes || !state.voiceNotes.length) {
          setStatus('Grave ou envie um trecho cantado primeiro.', true);
          return;
        }
        const manualBpm = $('rhythmManual').checked || ($('metroOn').checked && state.voiceGrid) ? voiceBpm() : common.bpm;
        song = Composer.composeFromVoice(Object.assign({}, common, {
          notes: state.voiceNotes, prompt: $('voicePrompt').value.trim(), lyrics: $('lyrics').value.trim(),
          bpm: state.voiceGrid ? state.voiceGrid.bpm : manualBpm, grid: state.voiceGrid,
        }));
      }
    } catch (e) {
      console.error(e);
      setStatus(e.message || 'Erro ao compor.', true);
      return;
    }
    if (engine() === 'ai') return generateAI(song);
    $('btnGen').disabled = $('btnAgain').disabled = true;
    setStatus('Compondo e tocando os instrumentos… 🎼');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const voiceBuffer = state.tab === 'voz' && $('includeVoice').checked ? state.voiceBuffer : null;
      let vocalBuffer = null;
      song.singer = null;
      const hasLyrics = !!$('lyrics').value.trim();
      if ($('singOn').checked && (state.tab === 'texto' || hasLyrics)) {
        setStatus('Ensinando a voz a cantar a letra… 🎙️');
        await new Promise((r) => setTimeout(r, 30));
        const profile = singerProfile();
        const sung = VoiceClone.songToSinging(song, profile);
        if (sung.length) {
          const totalSec = Synth.stepToTime(song, song.totalBars * 16) + 3;
          vocalBuffer = VoiceClone.renderSinging(sung, profile, totalSec);
          song.singer = profile.name;
        }
      }
      if (vocalBuffer && $('cloneAi').checked && AIMusic.available()) {
        const token = currentToken();
        if (!state.refBlob) {
          setStatus('Para cantar com a sua voz real, primeiro grave ou envie uma amostra em “Clonar voz”.', true);
          return song;
        }
        if (!/^hf_/.test(token)) {
          setStatus('Para cantar com a sua voz real, cole a chave grátis do Hugging Face em “Clonar voz”.', true);
          return song;
        }
        rememberToken(token);
        try {
          vocalBuffer = await AIMusic.convertVoice({ source: await toWavBlob(vocalBuffer), reference: state.refBlob, token, onStatus: (t) => setStatus(t) });
          song.singer = 'Sua voz real (IA)';
        } catch (e) {
          console.error(e);
          setStatus('⚠️ ' + e.message + ' Desta vez usei a voz sintética.', true);
          await new Promise((r) => setTimeout(r, 2500));
        }
        setStatus('Juntando sua voz com os instrumentos… 🎼');
      }
      state.gains.melody = vocalBuffer ? 0.3 : 0.9;
      const render = await Synth.render(song, {
        voiceBuffer,
        vocalBuffer,
        onProgress: (p) => setStatus('Compondo e tocando os instrumentos… ' + Math.round(p * 100) + '% 🎼'),
      });
      render.hasVoice = !!(voiceBuffer || vocalBuffer);
      state.song = song;
      state.render = render;
      state.offset = 0;
      showResult();
      setStatus('');
      play();
    } catch (e) {
      console.error(e);
      setStatus('Erro ao gerar o áudio: ' + e.message, true);
    } finally {
      $('btnGen').disabled = $('btnAgain').disabled = false;
    }
    return song;
  }

  function showResult() {
    const s = state.song;
    $('result').classList.remove('hidden');
    $('songTitle').textContent = s.title;
    const tags = [
      s.style.emoji + ' ' + s.style.name + (s.inferred ? ' (sugerido)' : ''),
      '🎼 ' + MT.keyName(s.key, s.mode),
      '⏱ ' + s.bpm + ' bpm',
      '⌛ ' + fmt(state.render.duration),
    ].concat(s.singer ? ['🎙️ ' + s.singer] : [])
      .concat(s.lyricsFit && s.lyricsFit.reps > 1
        ? ['📝 sua melodia tocada ' + s.lyricsFit.reps + 'x para caber a letra inteira']
        : []).concat(s.moods.map((m) => '✨ ' + (MOOD_PT[m] || m)));
    paintCover(s);
    if (state.render.ai) tags.splice(1, 0, '🤖 Gerada por IA (ACE-Step)');
    $('roll').parentElement.classList.toggle('hidden', !!state.render.ai);
    $('songTags').innerHTML = '';
    tags.forEach((t) => { const e = document.createElement('span'); e.className = 'tag'; e.textContent = t; $('songTags').appendChild(e); });

    const mix = $('mixer');
    mix.innerHTML = '';
    stemNames().forEach((name) => {
      const wrap = document.createElement('div');
      const lab = document.createElement('label');
      const label = name === 'voice' && s.singer ? 'Voz cantando' : STEM_INFO[name].label;
      lab.innerHTML = '<span><span class="dot" style="background:' + STEM_INFO[name].color + '"></span>' + label + '</span><span class="muted">' + Math.round(state.gains[name] * 100) + '%</span>';
      const r = document.createElement('input');
      r.type = 'range'; r.min = 0; r.max = 150; r.value = Math.round(state.gains[name] * 100);
      r.setAttribute('aria-label', 'Volume ' + STEM_INFO[name].label);
      r.oninput = () => {
        state.gains[name] = r.value / 100;
        lab.lastChild.textContent = r.value + '%';
        if (state.gainNodes[name]) state.gainNodes[name].gain.setTargetAtTime(state.gains[name], audioCtx().currentTime, 0.02);
      };
      wrap.appendChild(lab); wrap.appendChild(r);
      mix.appendChild(wrap);
    });
    drawRoll();
    updateTime();
    updateSizeHint();
    $('dlStatus').textContent = '';
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- reprodução ---------------- */

  function play() {
    if (!state.render) return;
    const ctx = audioCtx();
    stop(true);
    const master = ctx.createDynamicsCompressor();
    master.threshold.value = -10; master.ratio.value = 6; master.attack.value = 0.003; master.release.value = 0.2;
    const out = ctx.createGain(); out.gain.value = 0.9;
    master.connect(out).connect(ctx.destination);
    const when = ctx.currentTime + 0.05;
    const voiceOn = state.render.hasVoice;
    state.gainNodes = {};
    void voiceOn;
    state.sources = stemNames().map((name) => {
      const src = ctx.createBufferSource();
      src.buffer = state.render.stems[name];
      const g = ctx.createGain(); g.gain.value = state.gains[name];
      src.connect(g).connect(master);
      src.start(when, state.offset);
      state.gainNodes[name] = g;
      return src;
    });
    state.sources[0].onended = () => {
      if (state.playing && currentPos() >= state.render.duration - 0.1) { stop(); state.offset = 0; drawRoll(); updateTime(); }
    };
    state.startAt = when - state.offset;
    state.playing = true;
    $('btnPlay').textContent = '❚❚';
    $('btnPlay').setAttribute('aria-label', 'Pausar');
    loop();
  }

  function stop(keepOffset) {
    if (state.playing) state.offset = currentPos();
    state.sources.forEach((s) => { try { s.onended = null; s.stop(); } catch (e) { /* já parado */ } });
    state.sources = [];
    state.playing = false;
    cancelAnimationFrame(state.raf);
    $('btnPlay').textContent = '▶';
    $('btnPlay').setAttribute('aria-label', 'Tocar');
    if (!keepOffset) drawRoll();
  }

  function togglePlay() {
    if (state.playing) stop(); else play();
  }

  function seekTo(pos) {
    const was = state.playing;
    stop(true);
    state.offset = Math.max(0, Math.min(pos, state.render.duration - 0.05));
    if (was) play(); else { drawRoll(); updateTime(); }
  }

  function currentPos() {
    if (!state.playing) return state.offset;
    return Math.min(state.render.duration, audioCtx().currentTime - state.startAt);
  }

  function loop() {
    drawRoll();
    updateTime();
    if (state.playing) state.raf = requestAnimationFrame(loop);
  }

  function updateTime() {
    if (!state.render) return;
    const p = currentPos();
    $('timeLabel').textContent = fmt(p) + ' / ' + fmt(state.render.duration);
    $('seek').value = Math.round((p / state.render.duration) * 1000);
  }

  function fmt(s) {
    s = Math.max(0, s);
    return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  }

  /* ---------------- visualização (piano roll) ---------------- */

  function drawRoll() {
    const cv = $('roll');
    const s = state.song;
    if (!s || !state.render || state.render.ai || cv.offsetParent === null) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const col = (v) => css.getPropertyValue(v).trim();
    g.fillStyle = col('--roll-bg'); g.fillRect(0, 0, W, H);

    const dur = state.render.duration;
    const x = (step) => (Synth.stepToTime(s, step) / dur) * W;
    const top = 30, drumH = 22, bottom = H - drumH - 4;
    const melodic = [].concat(s.parts.bass, s.parts.chords, s.parts.lead, s.parts.pad);
    let lo = 127, hi = 0;
    melodic.forEach((n) => { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); });
    lo -= 2; hi += 2;
    const y = (m) => bottom - ((m - lo) / (hi - lo)) * (bottom - top);
    const nh = Math.max(2, (bottom - top) / (hi - lo) - 0.5);

    // grade de compassos e seções
    g.strokeStyle = col('--roll-grid'); g.lineWidth = 1;
    for (let b = 0; b <= s.totalBars; b++) {
      const xx = Math.round(x(b * 16)) + 0.5;
      g.beginPath(); g.moveTo(xx, top - 6); g.lineTo(xx, H); g.stroke();
    }
    g.font = '600 11px system-ui, sans-serif';
    g.fillStyle = col('--muted');
    s.sections.forEach((sec) => {
      const xx = x(sec.startBar * 16);
      g.fillText(sec.label, xx + 4, 13);
    });
    g.font = '10px system-ui, sans-serif';
    let lastName = '', chordEnd = -Infinity;
    s.chordNames.forEach((c) => {
      if (c.name === lastName) return;
      lastName = c.name;
      const cx = x(c.bar * 16) + 3;
      if (cx < chordEnd + 4) return; // evita sobrepor
      g.fillText(c.name, cx, 25);
      chordEnd = cx + g.measureText(c.name).width;
    });

    const drawNotes = (notes, color, alpha) => {
      g.fillStyle = color; g.globalAlpha = alpha;
      notes.forEach((n) => {
        const x0 = x(n.step), x1 = x(n.step + n.dur);
        g.fillRect(x0, y(n.midi) - nh / 2, Math.max(1.5, x1 - x0 - 0.5), nh);
      });
      g.globalAlpha = 1;
    };
    drawNotes(s.parts.pad, STEM_INFO.harmony.color, 0.18);
    drawNotes(s.parts.chords, STEM_INFO.harmony.color, 0.55);
    drawNotes(s.parts.bass, STEM_INFO.bass.color, 0.8);
    if (s.parts.lead2) drawNotes(s.parts.lead2.map((n) => Object.assign({}, n, { midi: Math.min(n.midi, hi) })), STEM_INFO.melody.color, 0.3);
    drawNotes(s.parts.lead, STEM_INFO.melody.color, 1);

    // sílabas da letra
    g.fillStyle = col('--text'); g.font = '10px system-ui, sans-serif';
    let sylEnd = -Infinity;
    s.parts.lead.forEach((n) => {
      if (!n.syl) return;
      const sx = x(n.step);
      if (sx < sylEnd + 2) return; // sem espaço: pula a sílaba
      g.fillText(n.syl, sx, y(n.midi) - nh / 2 - 3);
      sylEnd = sx + g.measureText(n.syl).width;
    });

    // bateria
    g.fillStyle = STEM_INFO.drums.color;
    s.parts.drums.forEach((d) => {
      const h = d.lane === 'kick' ? drumH : d.lane === 'snare' || d.lane === 'clap' ? drumH * 0.7 : drumH * 0.35;
      g.globalAlpha = 0.35 + d.vel * 0.5;
      g.fillRect(x(d.step), H - h - 2, 1.5, h);
    });
    g.globalAlpha = 1;

    // cursor
    const px = (currentPos() / dur) * W;
    g.fillStyle = col('--accent');
    g.fillRect(px - 1, 0, 2, H);
  }

  /* ---------------- download ---------------- */

  function fileName(ext) {
    const base = (state.song.title || 'musica').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'musica';
    return base + '-' + state.song.style.id + '.' + ext;
  }

  function currentGains() {
    const gains = Object.assign({}, state.gains);
    if (!state.render.hasVoice) gains.voice = 0;
    return gains;
  }

  function fmtBytes(b) {
    return b > 1e6 ? (b / 1e6).toFixed(b > 1e7 ? 0 : 1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
  }

  function updateSizeHint() {
    if (!state.render) return;
    const f = $('fmtSel').value;
    const est = f === 'midi' ? 0 : Formats.estimateSize(f, state.render.duration, state.render.sampleRate || 44100);
    $('fmtSize').textContent = est ? '(≈ ' + fmtBytes(est) + ')' : '';
  }

  const STEM_FILE = { drums: '1-bateria', bass: '2-baixo', harmony: '3-harmonia', melody: '4-melodia', voice: '5-voz', music: '1-musica-ia' };

  /* faixas presentes no resultado atual (no modo IA há uma só) */
  function stemNames() {
    return Object.keys(state.render.stems).filter((n) => n !== 'voice' || state.render.hasVoice);
  }

  async function downloadSelected() {
    if (!state.render || !state.song) return;
    const f = $('fmtSel').value;
    const btn = $('btnDownload');
    const status = (t) => { $('dlStatus').textContent = t; };
    btn.disabled = true;
    try {
      if (f === 'midi' && state.render.ai) {
        status('No modo IA a música já vem pronta em áudio, sem partitura. Escolha MP3, WAV ou FLAC.');
        return;
      }
      if (f === 'midi') {
        const got = await Exporter.download(Exporter.toMidi(state.song), fileName('mid'));
        status(got ? '✅ Pronto: ' + got : 'Download cancelado.');
        return;
      }
      status('Mixando…');
      await new Promise((r) => setTimeout(r, 20));
      const mix = Exporter.mixStems(state.render.stems, currentGains());
      let blob, ext;
      const prog = (label) => (p) => status(label + ' ' + Math.round(p * 100) + '%');
      if (f.startsWith('mp3')) {
        blob = await Formats.mp3(mix, parseInt(f.split('-')[1], 10), prog('Convertendo para MP3…'));
        ext = 'mp3';
      } else if (f === 'flac') {
        blob = await Formats.flac(mix, prog('Convertendo para FLAC…'));
        ext = 'flac';
      } else if (f === 'wav16' || f === 'wav24') {
        blob = Formats.wav(mix, f === 'wav24' ? 24 : 16);
        ext = 'wav';
      } else if (f === 'zip') {
        const files = [{ name: '0-mix-completo.wav', blob: Formats.wav(mix, 16) }];
        for (const name of stemNames()) {
          status('Preparando faixa: ' + STEM_INFO[name].label + '…');
          await new Promise((r) => setTimeout(r, 10));
          const st = state.render.stems[name];
          const one = { L: st.getChannelData(0), R: st.getChannelData(1), sr: st.sampleRate };
          files.push({ name: STEM_FILE[name] + '.wav', blob: Formats.wav(one, 16) });
        }
        if (!state.render.ai) files.push({ name: '6-partitura.mid', blob: Exporter.toMidi(state.song) });
        status('Compactando ZIP…');
        blob = await Formats.zip(files);
        ext = 'zip';
      }
      const got = await Exporter.download(blob, fileName(ext));
      status(got ? '✅ Pronto: ' + got + ' (' + fmtBytes(blob.size) + ')' : 'Download cancelado.');
    } catch (e) {
      console.error(e);
      status('⚠️ Erro ao converter: ' + e.message);
    } finally {
      btn.disabled = false;
    }
  }

  // acesso para testes automatizados
  window.App = { state, generate, setVoice, switchTab, useCloneRecording, saveClone, singerProfile };
  init();
})();

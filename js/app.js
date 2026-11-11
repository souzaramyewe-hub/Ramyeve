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
    drums: { label: 'Bateria', color: '#ffb547' },
    bass: { label: 'Baixo', color: '#3ccf91' },
    harmony: { label: 'Harmonia', color: '#5ca8ff' },
    melody: { label: 'Melodia', color: '#ff5c8a' },
    voice: { label: 'Sua voz', color: '#b07cff' },
  };

  const state = {
    tab: 'texto',
    song: null, render: null, variation: 0,
    voiceBuffer: null, voiceNotes: null,
    gains: { drums: 0.9, bass: 0.9, harmony: 0.8, melody: 0.9, voice: 1 },
    ctx: null, sources: [], gainNodes: {}, playing: false, startAt: 0, offset: 0,
    raf: 0,
  };

  /* ---------------- inicialização ---------------- */

  function init() {
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
    $('btnWav').onclick = downloadWav;
    $('btnMidi').onclick = () => {
      if (state.song) Exporter.download(Exporter.toMidi(state.song), fileName('mid'));
    };
    window.addEventListener('resize', drawRoll);
    $('lenSel').onchange = () => $('minutesWrap').classList.toggle('hidden', $('lenSel').value !== 'custom');
    $('btnClone').onclick = startClone;
    $('btnCancelClone').onclick = () => { if (cloneRec) { cloneRec.cancelled = true; cloneRec.mr.stop(); } };
    $('btnDemo').onclick = playDemo;
    $('btnDelClone').onclick = async () => {
      if (!confirm('Apagar a voz clonada deste aparelho?')) return;
      await VoiceClone.deleteProfile();
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
    opt.textContent = p ? '🧬 Minha voz clonada' : '🧬 Minha voz clonada (clone sua voz abaixo)';
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
      $('cloneStatus').textContent = '⚠️ Não foi possível acessar o microfone. Permita o acesso e tente de novo.';
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
    const p = await VoiceClone.profileFromGuidedRecording(buffer);
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

  /* ---------------- gravação de voz ---------------- */

  let rec = null;

  async function toggleRecord() {
    if (rec) { rec.stop(); return; }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      setStatus('Não foi possível acessar o microfone. Permita o acesso ou envie um arquivo de áudio.', true);
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
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
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
    setStatus('Gravando… cante sua melodia e clique em Parar.');
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
        song = Composer.composeFromVoice(Object.assign({ notes: state.voiceNotes, prompt: $('voicePrompt').value.trim() }, common));
      }
    } catch (e) {
      console.error(e);
      setStatus(e.message || 'Erro ao compor.', true);
      return;
    }
    $('btnGen').disabled = $('btnAgain').disabled = true;
    setStatus('Compondo e tocando os instrumentos… 🎼');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const voiceBuffer = state.tab === 'voz' && $('includeVoice').checked ? state.voiceBuffer : null;
      let vocalBuffer = null;
      song.singer = null;
      if (state.tab === 'texto' && $('singOn').checked) {
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
    ].concat(s.singer ? ['🎙️ ' + s.singer] : []).concat(s.moods.map((m) => '✨ ' + (MOOD_PT[m] || m)));
    $('songTags').innerHTML = '';
    tags.forEach((t) => { const e = document.createElement('span'); e.className = 'tag'; e.textContent = t; $('songTags').appendChild(e); });

    const mix = $('mixer');
    mix.innerHTML = '';
    Synth.STEMS.forEach((name) => {
      if (name === 'voice' && !state.render.hasVoice) return;
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
    state.sources = Synth.STEMS.filter((n) => n !== 'voice' || voiceOn).map((name) => {
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
    if (!s || !state.render || cv.offsetParent === null) return;
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

  function downloadWav() {
    if (!state.render) return;
    const voiceOn = state.render.hasVoice;
    const gains = Object.assign({}, state.gains);
    if (!voiceOn) gains.voice = 0;
    const blob = Exporter.toWav(Exporter.mixStems(state.render.stems, gains));
    Exporter.download(blob, fileName('wav'));
  }

  // acesso para testes automatizados
  window.App = { state, generate, setVoice, switchTab, useCloneRecording, singerProfile };
  init();
})();

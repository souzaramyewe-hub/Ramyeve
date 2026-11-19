/*
 * Modo "IA com voz realista": gera a música completa (instrumentos + voz
 * cantando a letra) com o ACE-Step, um modelo aberto (licença Apache 2.0)
 * que roda de graça nos servidores do Hugging Face (ZeroGPU).
 *
 * Requer uma chave gratuita do Hugging Face (o uso anônimo não tem cota).
 * A chave fica só no navegador da pessoa e é enviada apenas ao servidor do ACE-Step.
 * Não funciona dentro da página publicada no Claude, que bloqueia conexões externas.
 */
(function (global) {
  'use strict';
  // Servidores OFICIAIS (a chave da pessoa só é enviada a eles)
  const ACE_SPACES = ['https://ace-step-ace-step-v1-5.hf.space', 'https://ace-step-ace-step.hf.space'];
  const SEEDVC = 'https://plachta-seed-vc.hf.space';

  const STYLE_TAGS = {
    pop: 'pop, catchy, piano, synth, drums, bass guitar',
    rock: 'rock, electric guitar, drums, bass guitar, energetic',
    metal: 'heavy metal, distorted guitars, double bass drum, powerful',
    samba: 'samba, brazilian, cavaquinho, pandeiro, surdo, acoustic guitar',
    bossa: 'bossa nova, brazilian jazz, nylon guitar, soft drums, mellow',
    forro: 'forro, baiao, brazilian, accordion, zabumba, triangle',
    sertanejo: 'sertanejo, brazilian country, acoustic guitar, accordion',
    funkbr: 'brazilian funk, baile funk, 808 bass, tamborzao beat',
    reggae: 'reggae, one drop, skank guitar, organ, bass',
    reggaeton: 'reggaeton, dembow, latin, urban',
    jazz: 'jazz, swing, saxophone, piano, upright bass',
    blues: 'blues, electric guitar, shuffle, harmonica',
    lofi: 'lofi hip hop, chill, rhodes piano, vinyl, mellow beat',
    trap: 'trap, 808, hi-hats, dark, hip hop',
    house: 'house, edm, four on the floor, synth, dance',
    techno: 'techno, electronic, driving beat, synth',
    gospel: 'gospel, worship, piano, choir, uplifting',
    balada: 'romantic ballad, piano, strings, emotional',
    classica: 'orchestral, cinematic, strings, piano',
    ambient: 'ambient, atmospheric, pads, calm',
  };
  const MOOD_TAGS = { triste: 'sad, melancholic', alegre: 'happy, upbeat', calmo: 'calm, relaxed', energetico: 'energetic', romantico: 'romantic', misterioso: 'mysterious', epico: 'epic' };

  function available() { return !global.claude; }

  function buildTags(song, singer) {
    const parts = [STYLE_TAGS[song.style.id] || 'pop'];
    for (const m of song.moods || []) if (MOOD_TAGS[m]) parts.push(MOOD_TAGS[m]);
    parts.push(singer === 'masc' ? 'male vocal' : 'female vocal', 'brazilian portuguese vocals', song.bpm + ' bpm');
    return parts.join(', ');
  }

  /* Estrofes separadas por linha em branco: 1ª verso, 2ª refrão, depois alterna. */
  function buildLyrics(raw) {
    const stanzas = (raw || '').trim().split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (!stanzas.length) return '[instrumental]';
    return stanzas.map((s, i) => (i % 2 === 1 ? '[chorus]' : '[verse]') + '\n' + s).join('\n\n');
  }

  /* Traduz as mensagens do servidor para avisos claros. */
  function friendly(msg, what) {
    const m = String(msg || '');
    what = what || 'A IA';
    if (/quota/i.test(m)) {
      const wait = m.match(/Try again in ([0-9:]+)/i);
      const hasWait = wait && !/^0:00:0\d$/.test(wait[1]);
      if (/0s left/i.test(m) && /Authenticate/i.test(m)) {
        return 'O Hugging Face não reconheceu sua chave, então não liberou a cota grátis. Confira se colou a chave inteira (começa com hf_) ou crie uma nova do tipo "Read".';
      }
      return 'A cota gratuita de hoje no Hugging Face acabou' + (hasWait ? ' (libera de novo em ' + wait[1] + ')' : '') + '.';
    }
    if (/token|401|unauthori/i.test(m)) return 'A chave do Hugging Face não foi aceita. Crie uma nova (tipo "Read") e cole de novo.';
    if (/sleep|paused|building|503|not fully initialized|RepositoryNotFound/i.test(m)) return what + ' está fora do ar ou em manutenção no momento. Tente de novo mais tarde.';
    return what + ' não conseguiu terminar: ' + (m || 'erro desconhecido') + '.';
  }

  /*
   * Cabeçalho da chave: os servidores do Hugging Face (ZeroGPU) só contam a cota da
   * pessoa quando a chave vem em "x-hf-authorization" (é o que o cliente oficial faz).
   * Com "Authorization" o pedido era tratado como anônimo, sem cota.
   */
  function hfHeaders(token) {
    const t = (token || '').trim();
    return t ? { 'x-hf-authorization': 'Bearer ' + t } : {};
  }

  /* ---------- conversa com um servidor Gradio (fila) ---------- */

  const infoCache = {};
  async function describe(space, apiName) {
    const key = space + apiName;
    if (infoCache[key]) return infoCache[key];
    const [cfgR, infoR] = await Promise.all([fetch(space + '/config'), fetch(space + '/gradio_api/info')]);
    if (!cfgR.ok || !infoR.ok) throw new Error('503 servidor não respondeu');
    const cfg = await cfgR.json(), info = await infoR.json();
    const deps = cfg.dependencies || [];
    const i = deps.findIndex((d) => d.api_name === apiName.replace(/^\//, ''));
    const ep = (info.named_endpoints || {})[apiName];
    if (i < 0 || !ep) throw new Error('503 o servidor mudou e não aceita este pedido');
    infoCache[key] = { fn: deps[i].id != null ? deps[i].id : i, trigger: deps[i].targets && deps[i].targets[0] ? deps[i].targets[0][0] : null, params: ep.parameters };
    return infoCache[key];
  }

  /* Monta os argumentos usando os padrões do servidor e trocando só o necessário. */
  function buildArgs(params, pick) {
    return params.map((p) => {
      const v = pick(p);
      return v === undefined ? (p.parameter_default === undefined ? null : p.parameter_default) : v;
    });
  }

  async function upload(space, blob, name, auth) {
    const fd = new FormData();
    fd.append('files', blob, name);
    const r = await fetch(space + '/gradio_api/upload', { method: 'POST', headers: auth, body: fd });
    if (!r.ok) throw new Error('falha ao enviar o áudio (' + r.status + ')');
    const paths = await r.json();
    return { path: paths[0], orig_name: name, meta: { _type: 'gradio.FileData' } };
  }

  async function runQueue(space, apiName, data, token, onStatus, busyText) {
    const d = await describe(space, apiName);
    const session = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const auth = hfHeaders(token);
    const join = await fetch(space + '/gradio_api/queue/join', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body: JSON.stringify({ data: typeof data === 'function' ? data(d.params) : data, fn_index: d.fn, trigger_id: d.trigger, session_hash: session, event_data: null }),
    });
    if (!join.ok) throw new Error(join.status + ' ' + (await join.text()).slice(0, 200));
    const res = await fetch(space + '/gradio_api/queue/data?session_hash=' + session, { headers: auth });
    if (!res.ok || !res.body) throw new Error('falha na conexão (' + res.status + ')');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', output = null;
    const t0 = Date.now();
    while (!output) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, k); buf = buf.slice(k + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (msg.msg === 'estimation') onStatus(msg.rank > 0 ? 'Na fila do servidor gratuito: posição ' + (msg.rank + 1) + '…' : 'Sua vez chegou, preparando…');
        else if (msg.msg === 'process_starts' || msg.msg === 'progress') onStatus(busyText + ' ' + Math.round((Date.now() - t0) / 1000) + ' s');
        else if (msg.msg === 'process_completed') {
          if (!msg.success || (msg.output && msg.output.error)) throw new Error((msg.output && msg.output.error) || 'erro no servidor');
          output = msg.output.data;
        }
      }
    }
    try { reader.cancel(); } catch (e) { /* já fechado */ }
    if (!output) throw new Error('o servidor fechou a conexão sem resposta');
    return { output, auth };
  }

  async function fetchAudio(space, file, auth) {
    if (!file) throw new Error('o servidor não devolveu áudio');
    if (typeof file === 'string') file = { path: file };
    const url = file.url || (space + '/gradio_api/file=' + file.path);
    const r = await fetch(url, { headers: auth });
    if (!r.ok) throw new Error('não foi possível baixar o áudio (' + r.status + ')');
    return new OfflineAudioContext(2, 1, 44100).decodeAudioData(await r.arrayBuffer());
  }

  /* ---------- música completa com voz (ACE-Step) ---------- */

  async function generate(opts) {
    const onStatus = opts.onStatus || (() => {});
    const duration = Math.max(10, Math.min(240, Math.round(opts.duration || 60)));
    let lastErr = null;
    for (const space of ACE_SPACES) {
      try {
        onStatus('Conectando ao ACE-Step…');
        const isV15 = /v1-5/.test(space);
        const api = isV15 ? '/generation_wrapper' : '/__call__';
        const data = isV15
          ? (params) => buildArgs(params, (p) => {
            const n = p.parameter_name, l = (p.label || '').toLowerCase();
            if (n === 'selected_model') return 'acestep-v15-turbo';
            if (n === 'generation_mode') return 'custom';
            if (n === 'simple_query_input') return '';
            if (n === 'simple_vocal_language' || l === 'vocal language') return 'pt';
            if (l === 'prompt') return opts.tags;
            if (l === 'lyrics') return opts.lyrics;
            if (l.startsWith('audio duration')) return duration;
            if (l === 'batch size') return 1;
            if (l === 'audio format') return 'mp3';
            return undefined;
          })
          : [duration, opts.tags, opts.lyrics, 27, 15.0, 'euler', 'apg', 10.0, '', 0.5, 0.0, 3.0, true, false, true, '', 0.0, 0.0, false, 0.5, null, 'none'];
        const { output, auth } = await runQueue(space, api, data, opts.token, onStatus, 'A IA está compondo e cantando…');
        if (isV15 && !output[0]) throw new Error(String(output[10] || 'modelo indisponível'));
        onStatus('Baixando a música gerada…');
        return await fetchAudio(space, output[0], auth);
      } catch (e) {
        lastErr = e;
        if (/quota|token|401/i.test(String(e.message))) break; // não adianta tentar o outro servidor
      }
    }
    throw new Error(friendly(lastErr && lastErr.message, 'O ACE-Step'));
  }

  /* ---------- clonagem realista: troca a voz cantada pela da pessoa (Seed-VC) ---------- */

  async function convertVoice(opts) {
    const onStatus = opts.onStatus || (() => {});
    try {
      onStatus('Enviando a voz para a clonagem…');
      const auth = hfHeaders(opts.token);
      const src = await upload(SEEDVC, opts.source, 'voz.wav', auth);
      const ref = await upload(SEEDVC, opts.reference, 'referencia.wav', auth);
      const data = (params) => buildArgs(params, (p) => {
        const n = p.parameter_name;
        if (n === 'source_audio_path') return src;
        if (n === 'target_audio_path') return ref;
        if (n === 'diffusion_steps') return 30;
        if (n === 'f0_condition') return true;     // modo canto: mantém a melodia
        if (n === 'auto_f0_adjust') return true;   // leva para a faixa de voz da pessoa
        return undefined;
      });
      const { output, auth: a2 } = await runQueue(SEEDVC, '/predict_1', data, opts.token, onStatus, 'Trocando a voz pela sua…');
      onStatus('Baixando a voz clonada…');
      return await fetchAudio(SEEDVC, output[1] || output[0], a2);
    } catch (e) {
      throw new Error(friendly(e.message, 'A clonagem de voz (Seed-VC)'));
    }
  }

  global.AIMusic = { available, buildTags, buildLyrics, generate, convertVoice, friendly };
})(window);

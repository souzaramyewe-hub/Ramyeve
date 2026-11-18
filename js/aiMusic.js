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
  const SPACE = 'https://ace-step-ace-step.hf.space';
  const API = SPACE + '/gradio_api';

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

  let fnCache = null;
  async function endpoint() {
    if (fnCache) return fnCache;
    const r = await fetch(SPACE + '/config');
    if (!r.ok) throw new Error('O servidor do ACE-Step não respondeu (' + r.status + ').');
    const cfg = await r.json();
    const deps = cfg.dependencies || [];
    const i = deps.findIndex((d) => d.api_name === '__call__');
    if (i < 0) throw new Error('O servidor do ACE-Step mudou e não aceita mais este pedido.');
    fnCache = { fn: deps[i].id != null ? deps[i].id : i, trigger: deps[i].targets && deps[i].targets[0] ? deps[i].targets[0][0] : null };
    return fnCache;
  }

  /* Traduz as mensagens do servidor para avisos claros. */
  function friendly(msg) {
    const m = String(msg || '');
    if (/quota/i.test(m)) {
      const wait = m.match(/Try again in ([0-9:]+)/i);
      const hasWait = wait && !/^0:00:0\d$/.test(wait[1]);
      if (/0s left/i.test(m) && /Authenticate/i.test(m)) {
        return 'O Hugging Face não reconheceu sua chave, então não liberou a cota grátis. Confira se colou a chave inteira (começa com hf_) ou crie uma nova do tipo "Read".';
      }
      return 'A cota gratuita de hoje no Hugging Face acabou' + (hasWait ? ' (libera de novo em ' + wait[1] + ')' : '') +
        '. Enquanto isso, use a opção "Rápido, no navegador".';
    }
    if (/token|401|unauthori/i.test(m)) return 'A chave do Hugging Face não foi aceita. Crie uma nova (tipo "Read") e cole de novo.';
    if (/sleep|paused|building|503/i.test(m)) return 'O servidor do ACE-Step está ligando ou em manutenção. Tente de novo em alguns minutos.';
    return 'O ACE-Step não conseguiu gerar a música: ' + (m || 'erro desconhecido') + '.';
  }

  /*
   * Gera a música. opts: { tags, lyrics, duration, token, onStatus(texto) }
   * Retorna um AudioBuffer estéreo.
   */
  async function generate(opts) {
    const onStatus = opts.onStatus || (() => {});
    onStatus('Conectando ao ACE-Step…');
    const { fn, trigger } = await endpoint();
    const session = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const auth = opts.token ? { Authorization: 'Bearer ' + opts.token.trim() } : {};
    const data = [
      Math.max(10, Math.min(240, Math.round(opts.duration || 60))), opts.tags, opts.lyrics,
      27, 15.0, 'euler', 'apg', 10.0, '', 0.5, 0.0, 3.0, true, false, true, '', 0.0, 0.0, false, 0.5, null, 'none',
    ];
    const join = await fetch(API + '/queue/join', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body: JSON.stringify({ data, fn_index: fn, trigger_id: trigger, session_hash: session, event_data: null }),
    });
    if (!join.ok) throw new Error(friendly(join.status + ' ' + (await join.text()).slice(0, 200)));

    const res = await fetch(API + '/queue/data?session_hash=' + session, { headers: auth });
    if (!res.ok || !res.body) throw new Error(friendly('falha na conexão (' + res.status + ')'));
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
        if (msg.msg === 'estimation') {
          onStatus(msg.rank > 0 ? 'Na fila do servidor gratuito: posição ' + (msg.rank + 1) + '…' : 'Sua vez chegou, preparando…');
        } else if (msg.msg === 'process_starts') {
          onStatus('A IA está compondo e cantando… (leva de 30 s a 2 min)');
        } else if (msg.msg === 'progress') {
          onStatus('A IA está compondo e cantando… ' + Math.round((Date.now() - t0) / 1000) + ' s');
        } else if (msg.msg === 'process_completed') {
          if (!msg.success || (msg.output && msg.output.error)) throw new Error(friendly(msg.output && msg.output.error));
          output = msg.output.data;
        }
      }
    }
    try { reader.cancel(); } catch (e) { /* já fechado */ }
    if (!output || !output[0]) throw new Error(friendly('o servidor fechou a conexão sem enviar a música'));
    const file = output[0];
    const url = file.url || (API + '/file=' + file.path);
    onStatus('Baixando a música gerada…');
    const audio = await fetch(url, { headers: auth });
    if (!audio.ok) throw new Error(friendly('não foi possível baixar o áudio (' + audio.status + ')'));
    const ctx = new OfflineAudioContext(2, 1, 44100);
    return ctx.decodeAudioData(await audio.arrayBuffer());
  }

  global.AIMusic = { available, buildTags, buildLyrics, generate, friendly, SPACE };
})(window);

# 🎵 Ramyeve Música

Aplicativo web que **cria músicas de qualquer estilo** a partir de:

- **✍️ Um texto**: descreva a música ("samba alegre sobre o verão, com flauta, 100 bpm") e, se quiser, escreva uma letra. O ritmo da melodia acompanha as sílabas da letra.
- **🎤 Um trecho cantado**: grave sua voz (cantando, cantarolando ou assobiando) ou envie um áudio. O app detecta as notas, o tom e o andamento, cria a harmonia e faz o arranjo completo no estilo escolhido. Você pode manter sua voz na mixagem.

Tudo roda **no navegador**, sem servidor, sem cadastro e sem chave de API. Nenhum áudio sai do aparelho.

## Como usar

1. Abra o `index.html` em um navegador moderno (Chrome, Edge, Firefox ou Safari).
   - Para gravar pelo microfone, o navegador exige `https://` ou `localhost`. Para rodar localmente:
     ```bash
     python3 -m http.server 8000
     # abra http://localhost:8000
     ```
   - Para publicar, basta ativar o **GitHub Pages** neste repositório (Settings → Pages → branch principal, pasta raiz).
2. Escolha **Por texto** ou **Pela voz**.
3. (Opcional) Abra **Ajustes** para fixar estilo, tom, modo (maior/menor), duração e andamento.
4. Clique em **Gerar música**. Use **Outra versão** para variar a composição.
5. Ajuste o volume de cada parte no mixer e baixe em **WAV** (áudio) ou **MIDI** (partitura, para abrir em programas como GarageBand, FL Studio, MuseScore).

## Estilos disponíveis

Pop · Rock · Metal · Samba/Pagode · Bossa Nova/MPB · Forró/Baião · Sertanejo · Funk brasileiro · Reggae · Reggaeton · Jazz · Blues · Lo-fi · Trap/Hip-Hop · Eletrônica/House · Techno · Gospel/Louvor · Balada romântica · Clássica/Orquestral · Ambiente/Meditação

O texto também é interpretado para:

| O que você escreve | Efeito |
|---|---|
| clima: *triste, alegre, calmo, energético, romântico, épico, misterioso* | modo maior/menor, andamento, densidade |
| `120 bpm` | andamento exato |
| `em Lá menor`, `tom de C#`, `em Ré maior` | tonalidade |
| *piano, violão, guitarra, sanfona, sax, flauta, violino, cordas, órgão, sintetizador, cavaquinho* | instrumentos |
| texto entre aspas ou "sobre ..." | título da música |

Se nenhum estilo for citado, o app sugere um a partir do clima.

## Como funciona

| Arquivo | Função |
|---|---|
| `js/textAnalyzer.js` | Interpreta a descrição (estilo, clima, bpm, tom, instrumentos) e separa a letra em sílabas |
| `js/styles.js` | Padrões de bateria, baixo, acompanhamento, progressões e timbres de cada estilo |
| `js/composer.js` | Compõe estrutura (intro, verso, refrão, ponte, final), harmonia, baixo, bateria e melodia; harmoniza a melodia cantada |
| `js/pitch.js` | Detecta a altura da voz (algoritmo YIN) e segmenta em notas |
| `js/synth.js` | Sintetizador com Web Audio API: ~25 instrumentos e bateria gerados por síntese, reverb, mixagem por faixas |
| `js/export.js` | Exporta WAV e MIDI |
| `js/app.js` | Interface, gravação, reprodução, mixer e visualização (piano roll) |

A composição é determinística: o mesmo texto gera a mesma música; "Outra versão" muda a semente.

## Dicas para gravar

- Cante perto do microfone, em ambiente silencioso e **sem música de fundo**.
- Separe bem as notas (sílabas como "lá-lá-lá" funcionam melhor que um "uuuu" contínuo).
- Trechos de 5 a 20 segundos dão os melhores resultados.

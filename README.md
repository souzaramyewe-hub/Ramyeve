# 🎵 Ramyeve Música

Aplicativo web que **cria músicas de qualquer estilo** a partir de:

- **✍️ Um texto**: descreva a música ("samba alegre sobre o verão, com flauta, 100 bpm") e, se quiser, escreva uma letra. O ritmo da melodia acompanha as sílabas da letra.
- **🎤 Um trecho cantado**: grave sua voz (cantando, cantarolando ou assobiando) ou envie um áudio. O app detecta as notas, o tom e o andamento, cria a harmonia e faz o arranjo completo no estilo escolhido. Você pode manter sua voz na mixagem.

- **🧬 Sua voz clonada cantando**: clone sua voz em ~15 segundos (você canta as vogais A, E, I, O, U) e ela canta a letra da música. Também há vozes sintéticas feminina e masculina.
- **⏳ Sem tempo definido**: a música pode durar o tamanho da letra (modo "Livre") ou quantos minutos você quiser; a gravação de voz também não tem limite.

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
3. (Opcional) Em **🎙️ Voz cantando a letra**, clique em **Clonar minha voz** e cante cada vogal quando ela aparecer na tela. Depois escolha "Minha voz clonada" em *Quem canta*.
4. (Opcional) Abra **Ajustes** para fixar estilo, tom, modo (maior/menor), andamento e duração (*Livre*, curta, média, longa ou *Escolher minutos…*).
5. Clique em **Gerar música**. Use **Outra versão** para variar a composição.
6. Ajuste o volume de cada parte no mixer e baixe em **WAV** (áudio) ou **MIDI** (partitura, para abrir em programas como GarageBand, FL Studio, MuseScore).

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
| `js/voice.js` | Clonagem de voz (marcas de pitch por vogal), canto por TD-PSOLA com consoantes do português, vozes sintéticas e armazenamento local (IndexedDB) |
| `js/synth.js` | Sintetizador com Web Audio API: ~25 instrumentos e bateria gerados por síntese, reverb, mixagem por faixas |
| `js/export.js` | Exporta WAV e MIDI |
| `js/app.js` | Interface, gravação, reprodução, mixer e visualização (piano roll) |

A composição é determinística: o mesmo texto gera a mesma música; "Outra versão" muda a semente.

## Sobre a voz clonada

A clonagem é feita **localmente**: o app guarda trechos de cada vogal da sua voz e os recombina (técnica TD-PSOLA) para cantar qualquer nota, mantendo o seu timbre. As consoantes são aproximadas. O resultado lembra a sua voz, mas é menos natural que serviços de IA em servidores (que treinam redes neurais com minutos de áudio). A voz fica salva só no seu navegador e pode ser apagada a qualquer momento. Use apenas a sua voz ou de quem autorizou.

Para clonar melhor: ambiente silencioso, cante cada vogal **sem parar e na mesma nota** durante todo o tempo em que ela aparece, numa altura confortável.

## Duração

- **Livre**: cada linha da letra vira uma frase de 2 compassos; o refrão (2ª estrofe) se repete depois de cada novo verso.
- **Escolher minutos**: qualquer valor, sem limite máximo. Músicas acima de 4 minutos usam taxa de amostragem menor para economizar memória; músicas muito longas (10 min+) podem demorar e exigir bastante memória do aparelho.

## Dicas para gravar

- Cante perto do microfone, em ambiente silencioso e **sem música de fundo**.
- Separe bem as notas (sílabas como "lá-lá-lá" funcionam melhor que um "uuuu" contínuo).
- Trechos de 5 a 20 segundos dão os melhores resultados.

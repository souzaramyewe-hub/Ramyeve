#!/usr/bin/env python3
"""
Gera os bancos de sons gravados usados pelo app (js/samples/*.js).

Fontes (gratuitas, de uso livre):
  - Instrumentos: FluidR3_GM (Frank Wen), versão pré-renderizada por gleitz/midi-js-soundfonts.
    Licença: Creative Commons Attribution 3.0.
  - Baterias: Gradigang-Solutions/kringel-samples (SonicPiAcoustic e Fischer808). Licença: CC0 1.0.

Uso:
  python3 tools/build_samples.py <pasta_fluid> <pasta_kit> <pasta_saida>

<pasta_fluid> contém os arquivos <instrumento>-mp3.js do FluidR3_GM;
<pasta_kit> contém ac_*.flac e 808_*.wav do kringel-samples.
Requer ffmpeg. Cada instrumento guarda uma nota a cada 3 semitons (as demais
são obtidas mudando a afinação da gravação mais próxima), em MP3 mono.
"""
import base64
import json
import os
import re
import subprocess
import sys
import tempfile

STEP = 3            # semitons entre notas gravadas
BITRATE = '48k'     # MP3 mono

# id no app: (arquivo FluidR3, nota mínima, nota máxima, duração em s, laço (início, fim) ou None)
INSTRUMENTS = {
    'piano':        ('acoustic_grand_piano', 36, 96, 3.0, None),
    'epiano':       ('electric_piano_1', 36, 88, 2.5, None),
    'organ':        ('drawbar_organ', 36, 84, 2.6, (0.6, 2.3)),
    'nylon':        ('acoustic_guitar_nylon', 40, 84, 2.4, None),
    'steelGuitar':  ('acoustic_guitar_steel', 40, 84, 2.4, None),
    'distGuitar':   ('distortion_guitar', 40, 76, 2.6, (0.8, 2.3)),
    'leadGuitar':   ('overdriven_guitar', 43, 88, 2.6, (0.8, 2.3)),
    'acousticBass': ('acoustic_bass', 28, 60, 2.0, None),
    'pickBass':     ('electric_bass_pick', 28, 60, 2.0, None),
    'fingerBass':   ('electric_bass_finger', 28, 60, 2.0, None),
    'violin':       ('violin', 55, 96, 2.6, (0.8, 2.3)),
    'cello':        ('cello', 36, 72, 2.6, (0.8, 2.3)),
    'strings':      ('string_ensemble_1', 36, 84, 2.8, (1.0, 2.5)),
    'sax':          ('tenor_sax', 44, 80, 2.6, (0.8, 2.3)),
    'flute':        ('flute', 60, 96, 2.6, (0.8, 2.3)),
    'accordion':    ('accordion', 48, 84, 2.6, (0.8, 2.3)),
    'harmonica':    ('harmonica', 55, 88, 2.4, (0.8, 2.1)),
    'vibes':        ('vibraphone', 53, 96, 2.5, None),
}

# faixa da bateria no app -> arquivo (acústica / 808)
KITS = {
    'acoustic': {'kick': 'ac_bd.flac', 'snare': 'ac_sd.flac', 'hat': 'ac_hh.flac', 'ohat': 'ac_oh.flac',
                 'crash': 'ac_cr.flac', 'ride': 'ac_rd.flac', 'tom': 'ac_mt.flac', 'cowbell': 'ac_cb.flac',
                 'clap': '808_cp.wav', 'rim': '808_rim.wav', 'shaker': '808_sh.wav'},
    '808': {'kick': '808_bd.wav', 'snare': '808_sd.wav', 'hat': '808_hh.wav', 'ohat': '808_oh.wav',
            'crash': '808_cr.wav', 'ride': '808_oh.wav', 'tom': '808_mt.wav', 'cowbell': '808_cb.wav',
            'clap': '808_cp.wav', 'rim': '808_rim.wav', 'shaker': '808_sh.wav'},
}
LONG_DRUMS = {'crash', 'ride', 'ohat'}

NOTE_PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def name_to_midi(name):
    m = re.fullmatch(r'([A-G])(b?)(-?\d)', name)
    if not m:
        return None
    return NOTE_PC[m.group(1)] - (1 if m.group(2) else 0) + (int(m.group(3)) + 1) * 12


def encode(src_path, seconds, tmpdir, fade=0.08, bitrate=BITRATE):
    out = os.path.join(tmpdir, 'o.mp3')
    af = 'silenceremove=start_periods=1:start_threshold=-60dB,afade=t=out:st=%.3f:d=%.3f' % (max(0.05, seconds - fade), fade)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src_path, '-t', '%.3f' % seconds, '-af', af,
                    '-ac', '1', '-ar', '44100', '-b:a', bitrate, out], check=True)
    with open(out, 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


def write_js(out_dir, key, payload):
    path = os.path.join(out_dir, key + '.js')
    with open(path, 'w', encoding='ascii') as f:
        f.write('(window.RAMYEVE_SAMPLES = window.RAMYEVE_SAMPLES || {})[%s] = %s;\n' % (json.dumps(key), json.dumps(payload, separators=(',', ':'))))
    return os.path.getsize(path)


def main():
    fluid_dir, kit_dir, out_dir = sys.argv[1:4]
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    with tempfile.TemporaryDirectory() as tmp:
        for key, (fname, lo, hi, secs, loop) in INSTRUMENTS.items():
            text = open(os.path.join(fluid_dir, fname + '-mp3.js'), encoding='utf8').read()
            avail = {}
            for nm, b64 in re.findall(r'"([A-G]b?-?\d)":\s*"data:audio/mp3;base64,([^"]+)"', text):
                m = name_to_midi(nm)
                if m is not None:
                    avail[m] = b64
            notes = {}
            for target in range(lo, hi + 1, STEP):
                m = min(avail, key=lambda x: abs(x - target))
                src = os.path.join(tmp, 'in.mp3')
                with open(src, 'wb') as f:
                    f.write(base64.b64decode(avail[m]))
                notes[str(m)] = encode(src, secs, tmp)
            size = write_js(out_dir, key, {'kind': 'melodic', 'source': 'FluidR3_GM (CC BY 3.0)', 'loop': loop, 'notes': notes})
            total += size
            print('%-13s %2d notas  %6.0f KB' % (key, len(notes), size / 1024))
        for kit, lanes in KITS.items():
            sounds = {}
            for lane, fname in lanes.items():
                secs = 2.2 if lane in LONG_DRUMS else 1.2
                sounds[lane] = encode(os.path.join(kit_dir, fname), secs, tmp, fade=0.05, bitrate='64k')
            size = write_js(out_dir, 'kit-' + kit, {'kind': 'drums', 'source': 'kringel-samples (CC0)', 'sounds': sounds})
            total += size
            print('%-13s %2d sons   %6.0f KB' % ('kit-' + kit, len(sounds), size / 1024))
    print('total %.1f MB' % (total / 1024 / 1024))


if __name__ == '__main__':
    main()

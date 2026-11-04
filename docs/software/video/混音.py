"""为体验影片保留一条连续配乐，仅在阅读段缓慢降低音量。"""
from pathlib import Path
import json, os, subprocess, wave
import numpy as np

root = Path(__file__).resolve().parents[3]
out = root / 'output/v3'
public = root / 'docs/software/video/public'
ffmpeg = os.environ.get('FFMPEG_PATH', 'ffmpeg')
rate = 48000
scenes = json.loads((root / 'docs/software/video/场景.json').read_text(encoding='utf-8'))
seconds = sum(s['seconds'] for s in scenes)
out.mkdir(parents=True, exist_ok=True)
source = out / 'dreamy-jazz.mp3'
assert source.exists(), '将 Dreamy Jazz 保存到 output/v3/dreamy-jazz.mp3'

# 两遍线性响度校准保留原曲的动态，避免每个段落重新归一化。
measure = subprocess.run([ffmpeg, '-hide_banner', '-i', str(source), '-af',
    'loudnorm=I=-25:TP=-6:LRA=15:print_format=json', '-f', 'null', '-'],
    capture_output=True, text=True, check=True)
stats = json.JSONDecoder().raw_decode(measure.stderr[measure.stderr.rfind('{'):])[0]
norm = ('loudnorm=I=-25:TP=-6:LRA=15:linear=true:'
        f'measured_I={stats["input_i"]}:measured_TP={stats["input_tp"]}:'
        f'measured_LRA={stats["input_lra"]}:measured_thresh={stats["input_thresh"]}:'
        f'offset={stats["target_offset"]}')
wav = out / '连续母带.wav'
subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(source), '-af', norm,
    '-ar', str(rate), '-ac', '2', '-c:a', 'pcm_s16le', str(wav)], check=True)
with wave.open(str(wav), 'rb') as stream:
    track = np.frombuffer(stream.readframes(stream.getnframes()), dtype=np.int16).reshape(-1, 2).astype(np.float64) / 32768

lead = 2.8
music = np.zeros((round(rate * seconds), 2), np.float64)
start = round(lead * rate)
assert len(track) <= len(music) - start, '时间轴需容纳完整曲目'
t = np.arange(len(track)) / rate + lead
gain = np.ones(len(track))

def smooth(a, b):
    p = np.clip((t - a) / (b - a), 0, 1)
    return p * p * (3 - 2 * p)

# 只改变响度，不切片、不循环、不更换调性；六秒坡度留出自然呼吸。
for a, b in [(49, 64), (87, 98)]:
    gain *= 1 - .18 * (smooth(a - 6, a) - smooth(b, b + 6))
gain *= smooth(lead, lead + .65)
gain *= 1 - smooth(lead + len(track) / rate - 2.4, lead + len(track) / rate)
music[start:start + len(track)] = track * gain[:, None]
assert np.max(abs(np.diff(gain))) < .0001
assert np.all(gain[(t > lead + 1) & (t < t[-1] - 3)] > .65)

mix = music.copy()
cursor = 0
cues = []
for scene in scenes:
    if 'click' in scene:
        cues.append({'second': round(cursor + scene['click'], 3), 'type': 'click'})
    cursor += scene['seconds']

# 短、低音量的实体点击，不在逐字输入或每次转场上叠加声音。
rng = np.random.default_rng(21)
for cue in cues:
    local_t = np.arange(round(.045 * rate)) / rate
    noise = rng.normal(0, 1, len(local_t))
    softened = np.convolve(noise, np.ones(9) / 9, 'same')
    click = (softened * .055 + np.sin(2*np.pi*830*local_t) * .025) * np.exp(-local_t*135)
    at = round(cue['second'] * rate)
    mix[at:at + len(click)] += click[:, None]

assert seconds == 140
assert len(cues) == 6
assert np.max(abs(mix)) < .8
assert np.max(abs(music[:start])) == 0
for data, name in [(music, '纯配乐'), (mix, '体验配乐')]:
    target = out / (name + '.wav')
    with wave.open(str(target), 'wb') as stream:
        stream.setparams((2, 2, rate, 0, 'NONE', 'not compressed'))
        stream.writeframes((data * 32767).astype(np.int16).tobytes())
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(target), '-c:a',
        'libmp3lame', '-b:a', '192k', str(public / (name + '.mp3'))], check=True)

manifest = {'seconds': seconds, 'track': 'Dreamy Jazz', 'author': 'Francisco Alvear',
    'source': 'https://assets.mixkit.co/music/645/645.mp3', 'musicStart': lead,
    'musicEnd': round(lead + len(track) / rate, 3), 'sourceCuts': 0,
    'readingGain': .82, 'gainRampSeconds': 6, 'cues': cues}
(root / 'docs/software/video/声音事件.json').write_bytes(json.dumps(manifest, ensure_ascii=False, indent=2).encode('utf-8'))
print(json.dumps({'seconds': seconds, 'sourceCuts': 0, 'sfx': len(cues), 'peak': float(abs(mix).max())}))

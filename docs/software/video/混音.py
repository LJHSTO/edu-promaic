from pathlib import Path
import subprocess,json,wave,os
import numpy as np
root=Path('docs/software/video');f=os.environ.get('FFMPEG_PATH','ffmpeg')
cmd=[f,'-v','error','-y','-i','output/review/close-up.mp3','-i','output/review/digital-clouds.mp3','-filter_complex','[0:a]atrim=0:79,asetpts=PTS-STARTPTS,volume=0.23[a];[1:a]atrim=16:53,asetpts=PTS-STARTPTS,volume=0.16[b];[0:a]atrim=52:86,asetpts=PTS-STARTPTS,volume=0.23[c];[a][b]acrossfade=d=1[ab];[ab][c]acrossfade=d=1,afade=t=in:d=1.3,afade=t=out:st=145:d=3,loudnorm=I=-24:TP=-5:LRA=9','-ar','48000','-ac','2','output/review/bed.wav'];subprocess.run(cmd,check=True)
with wave.open('output/review/bed.wav','rb') as w: bed=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).reshape(-1,2).astype(np.float64)/32768
story=json.loads((root/'story.json').read_text(encoding='utf-8-sig'));total=sum(x['duration'] for x in story);pos=0;rng=np.random.default_rng(42);cue=[]
for i,s in enumerate(story):
 pos+=s['duration'];sec=round(pos/total*4440)/30-8/30
 if not s['click']:continue
 t=np.arange(2400)/48000;click=(rng.normal(0,.13,len(t))+np.sin(t*2*np.pi*1450)*.25)*np.exp(-t*115)*.21
 start=int(sec*48000);end=min(len(bed),start+len(t));bed[start:end]+=click[:end-start,None];cue.append({'秒':round(sec,3),'动作':s['name']})
 if s['name'] in ['提交新题','课程调整']:
  tt=np.arange(23040)/48000;ding=(np.sin(2*np.pi*660*tt)+.5*np.sin(2*np.pi*990*tt))*np.exp(-tt*9)*.045;start+=int(.28*48000);end=min(len(bed),start+len(ding));bed[start:end]+=ding[:end-start,None]
assert np.max(np.abs(bed))<.95
with wave.open('output/review/mix.wav','wb') as w:w.setparams((2,2,48000,0,'NONE','not compressed'));w.writeframes((bed*32767).astype(np.int16).tobytes())
subprocess.run([f,'-v','error','-y','-i','output/review/mix.wav','-c:a','libmp3lame','-b:a','192k',str(root/'public/体验配乐.mp3')],check=True)
(root/'声音事件.json').write_text(json.dumps({'配乐段落':[[0,78,'Close Up'],[78,114,'Digital Clouds'],[114,148,'Close Up']], '点击':cue},ensure_ascii=False,indent=2),encoding='utf-8')
print('audio',len(bed)/48000,'clicks',len(cue))

from pathlib import Path
import json, os, subprocess, wave
import numpy as np

root=Path(__file__).resolve().parents[3]
out=root/'output/v2'; public=root/'docs/software/video/public'
ffmpeg=os.environ.get('FFMPEG_PATH','ffmpeg'); rate=48000; seconds=124
out.mkdir(parents=True,exist_ok=True)
sources={'groove':'872','vastness':'184','dry-gin':'868'}
music=np.zeros((rate*seconds,2),np.float64)
def decode(name):
    target=out/(name+'.wav')
    subprocess.run([ffmpeg,'-v','error','-y','-i',str(out/(name+'.mp3')),'-af','loudnorm=I=-25:TP=-6:LRA=10','-ar',str(rate),'-ac','2',str(target)],check=True)
    with wave.open(str(target),'rb') as f:return np.frombuffer(f.readframes(f.getnframes()),dtype=np.int16).reshape(-1,2).astype(np.float64)/32768
tracks={name:decode(name) for name in sources}
segments=[('groove',5,34,0,1),('vastness',34,60,22,.8),('groove',60,78,35,.9),('vastness',83,93,60,.7),('dry-gin',93,124,8,.95)]
for name,start,end,offset,gain in segments:
    clip=tracks[name][int(offset*rate):int((offset+end-start)*rate)].copy()*gain
    assert len(clip)==int((end-start)*rate)
    fade=int(.6*rate);clip[:fade]*=np.linspace(0,1,fade)[:,None];clip[-fade:]*=np.linspace(1,0,fade)[:,None]
    if end==124:clip[-rate*3:]*=np.linspace(1,0,rate*3)[:,None]
    music[int(start*rate):int(end*rate)]+=clip
mix=music.copy();rng=np.random.default_rng(9)
cues=[(100/30,'click'),(10+94/30,'click'),(27,'swish'),(34+65/30,'click'),(42+135/30,'switch'),(51+50/30,'swish'),(60+100/30,'switch'),(72+50/30,'chime'),(78,'hit'),(83+115/30,'click'),(83+175/30,'chime'),(101+115/30,'switch'),(111+103/30,'click'),(118,'hit')]
def sound(kind):
    duration={'click':.055,'switch':.12,'swish':.34,'chime':.48,'hit':.40}[kind];t=np.arange(int(duration*rate))/rate
    if kind=='click':return (rng.normal(0,.55,len(t))+np.sin(t*2*np.pi*1600)*.25)*np.exp(-t*120)*.115
    if kind=='switch':return np.sin(2*np.pi*(650*t+700*t*t))*np.exp(-t*38)*.045
    if kind=='chime':return (np.sin(2*np.pi*659.25*t)+.4*np.sin(2*np.pi*987.77*t))*np.exp(-t*10)*.035
    if kind=='hit':return np.sin(2*np.pi*(78*t-50*t*t))*np.exp(-t*14)*.065
    n=rng.normal(0,1,len(t));filtered=np.convolve(n,np.ones(23)/23,'same');return filtered*np.sin(np.pi*t/duration)**2*.14
for at,kind in cues:
    s=sound(kind);start=int(at*rate);end=min(len(mix),start+len(s));mix[start:end]+=s[:end-start,None]
assert np.max(abs(mix))<.8
assert np.max(abs(music[:5*rate]))==0
assert np.max(abs(music[78*rate:83*rate]))==0
for data,name in [(music,'纯配乐'),(mix,'体验配乐')]:
    wav=out/(name+'.wav')
    with wave.open(str(wav),'wb') as f:f.setparams((2,2,rate,0,'NONE','not compressed'));f.writeframes((data*32767).astype(np.int16).tobytes())
    subprocess.run([ffmpeg,'-v','error','-y','-i',str(wav),'-c:a','libmp3lame','-b:a','192k',str(public/(name+'.mp3'))],check=True)
manifest={'seconds':seconds,'silentMusicRanges':[[0,5],[78,83]],'segments':[dict(track=a,start=b,end=c,sourceOffset=d,gain=e) for a,b,c,d,e in segments],'cues':[dict(second=round(at,3),type=kind) for at,kind in cues]}
(root/'docs/software/video/声音事件.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'seconds':seconds,'musicSegments':len(segments),'sfx':len(cues),'peak':float(abs(mix).max())}))

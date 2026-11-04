import React from 'react';
import {AbsoluteFill,Audio,Composition,registerRoot,staticFile,useCurrentFrame} from 'remotion';
import timeline from './场景.json';
import targets from './点击位置.json';
import {Platform,P,FONT,Logo,ease} from './平台界面';

const FPS=30;
export const TOTAL=timeline.reduce((n,s)=>n+s.seconds*FPS,0);
export const scenes=timeline.map(s=>[s.id,s.seconds] as const);

function Pointer({id,f,at}:{id:string,f:number,at:number}) {
 const target=(targets as Record<string,{x:number,y:number}>)[id];
 if(!target||f<at-10||f>at+13)return null;
 const p=ease((f-at+10)/9),after=Math.max(0,(f-at)/13);
 return <>
  {f>=at&&<div style={{position:'absolute',left:target.x-20,top:target.y-20,width:40,height:40,borderRadius:'50%',border:'2px solid #7186ef',opacity:(1-after)*.7,scale:1+after*.8}}/>}
  <svg viewBox="0 0 34 42" width="29" height="36" style={{position:'absolute',left:target.x+32*(1-p),top:target.y+25*(1-p),filter:'drop-shadow(1px 2px 2px #17233d44)',scale:f>=at&&f<at+3?.92:1}}><path d="M2 2L3 31L11 24L18 39L24 36L17 23L31 21Z" fill="white" stroke="#23304c" strokeWidth="2"/></svg>
 </>;
}
function Frame({id,f,index,globalFrame}:{id:string,f:number,index:number,globalFrame:number}) {
 const scene=timeline[index];
 return <AbsoluteFill style={{background:'#e8eef7',color:P.ink,fontFamily:FONT,overflow:'hidden'}}>
  <style>{'*{box-sizing:border-box}body{margin:0}'}</style>
  <div style={{position:'absolute',left:42,right:42,top:24,display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:19,color:'#687792'}}><span>知点 · 完整使用体验</span><span style={{display:'flex',alignItems:'center',gap:16}}><span style={{height:5,width:5,background:P.blue,borderRadius:'50%'}}/>{scene.chapter}</span></div>
  <div style={{position:'absolute',left:36,top:72}}><Platform id={id} f={f}/></div>
  <div style={{position:'absolute',left:42,right:42,top:1021,display:'flex',alignItems:'center',justifyContent:'space-between',gap:20}}><div style={{fontSize:25,fontWeight:500,letterSpacing:.1}}>{scene.caption}</div><div style={{fontSize:16,color:'#8290a6',whiteSpace:'nowrap'}}>{String(index+1).padStart(2,'0')} / {timeline.length}</div></div>
  <div style={{position:'absolute',left:0,bottom:0,height:3,width:(globalFrame/TOTAL*100)+'%',background:'#8c9ee4'}}/>
  {'click' in scene&&<Pointer id={id} f={f} at={Math.round(scene.click!*FPS)}/>}
 </AbsoluteFill>;
}
function Master({sfx=true}:{sfx?:boolean}) {
 const frame=useCurrentFrame();
 let start=0,index=0;
 for(let i=0;i<timeline.length;i++){
  if(frame<start+timeline[i].seconds*FPS){index=i;break}
  start+=timeline[i].seconds*FPS;
 }
 return <><Frame id={timeline[index].id} f={frame-start} index={index} globalFrame={frame}/><Audio src={staticFile(sfx?'体验配乐.mp3':'纯配乐.mp3')}/></>;
}
function Debug({id}:{id:string}) {
 const index=timeline.findIndex(s=>s.id===id),f=useCurrentFrame();
 const start=timeline.slice(0,index).reduce((n,s)=>n+s.seconds*FPS,0);
 return <Frame id={id} f={f} index={index} globalFrame={start+f}/>;
}
function Cover() {
 return <AbsoluteFill style={{background:'#e8eef7',fontFamily:FONT,color:P.ink}}>
  <style>{'*{box-sizing:border-box}body{margin:0}'}</style>
  <div style={{position:'absolute',left:76,top:38}}><Logo/></div>
  <div style={{position:'absolute',left:76,top:102,fontSize:58,fontWeight:700,letterSpacing:-2}}>一次完整的主动学习体验</div>
  <div style={{position:'absolute',right:78,top:121,fontSize:23,color:P.muted}}>课程 · 探索 · 助教 · 独立练习</div>
  <div style={{position:'absolute',left:118,top:222,scale:.91,transformOrigin:'top left'}}><Platform id="explore" f={290}/></div>
 </AbsoluteFill>;
}
registerRoot(()=> <>
 <Composition id="Experience" component={Master} width={1920} height={1080} fps={FPS} durationInFrames={TOTAL}/>
 <Composition id="Experience-NoSfx" component={Master} defaultProps={{sfx:false}} width={1920} height={1080} fps={FPS} durationInFrames={TOTAL}/>
 <Composition id="Cover" component={Cover} width={1920} height={1080} fps={FPS} durationInFrames={1}/>
 {timeline.map(s=><Composition key={s.id} id={'Scene-'+s.id} component={Debug} defaultProps={{id:s.id}} width={1920} height={1080} fps={FPS} durationInFrames={s.seconds*FPS}/>)}
</>);

const path=require('path'),fs=require('fs');
const deps=process.env.ZHIDIAN_VIDEO_MODULES||path.join(__dirname,'node_modules');
const {bundle}=require(path.join(deps,'@remotion/bundler'));
const {selectComposition,renderMedia,renderStill,openBrowser}=require(path.join(deps,'@remotion/renderer'));
(async()=>{
 const output=path.resolve(__dirname,'../../../output/v3');fs.mkdirSync(output,{recursive:true});
 const url=await bundle({entryPoint:path.join(__dirname,'Film.tsx'),publicDir:path.join(__dirname,'public'),webpackOverride:c=>({...c,resolve:{...c.resolve,modules:[deps,...c.resolve.modules||[]]}})});
 const browser=await openBrowser('chrome',{browserExecutable:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const c=await selectComposition({serveUrl:url,id:'Experience',puppeteerInstance:browser});
  if(process.argv.includes('--stills')){
   const timeline=require('./场景.json');let cursor=0;const times=[];
   for(const s of timeline){times.push(cursor+s.sample);if(s.click!==undefined)times.push(cursor+s.click);cursor+=s.seconds}
   times.push(0,cursor-1/30);
   for(const second of times)await renderStill({serveUrl:url,composition:c,frame:Math.round(second*30),output:path.join(output,`画面-${second}.png`),puppeteerInstance:browser});
   const cover=await selectComposition({serveUrl:url,id:'Cover',puppeteerInstance:browser});await renderStill({serveUrl:url,composition:cover,frame:0,output:path.join(__dirname,'../media/原型封面.png'),puppeteerInstance:browser});
   console.log('stills: '+times.length);
  }else{
   const preview=process.argv.includes('--preview');let last=0;
   await renderMedia({serveUrl:url,composition:c,outputLocation:preview?path.join(output,'新版开场.mp4'):path.join(__dirname,'../media/原型完整体验.mp4'),frameRange:preview?[0,539]:undefined,codec:'h264',crf:18,colorSpace:'bt709',audioCodec:'aac',audioBitrate:'192k',concurrency:4,puppeteerInstance:browser,onProgress:p=>{if(Date.now()-last>20000){last=Date.now();console.log(Math.round(p.progress*100)+'%')}}});
  }
 }finally{await browser.close({silent:true})}
})().catch(e=>{console.error(e);process.exitCode=1});

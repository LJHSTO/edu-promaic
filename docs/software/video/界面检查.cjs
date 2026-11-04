const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..');
const deps=process.env.ZHIDIAN_VIDEO_MODULES||path.join(__dirname,'node_modules');
const React=require(path.join(deps,'react'));
const ReactDOM=require(path.join(deps,'react-dom/server'));
const ts=require(path.join(deps,'typescript'));
const {chromium}=require(process.env.ZHIDIAN_PLAYWRIGHT_MODULE||'playwright-core');
const input=fs.readFileSync(path.join(__dirname,'平台界面.tsx'),'utf8');
const result=ts.transpileModule(input,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2020},reportDiagnostics:true});
assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const mod={exports:{}};
new Function('require','module','exports',result.outputText)(name=>require(path.join(deps,name)),mod,mod.exports);
const {Platform}=mod.exports,scenes=require('./场景.json');
const selectors={entry:['进入工作台',0],courses:['进入学习',0],help:['给我线索',0],check:['提交判断',0],teacher:['回放 ↗',2],publish:['确认发布',0]};
const out=path.join(root,'output/v3');fs.mkdirSync(out,{recursive:true});
assert.equal(scenes.reduce((n,s)=>n+s.seconds,0),140);
assert.equal(new Set(scenes.map(s=>s.id)).size,scenes.length);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 const targets={},issues=[];
 async function load(s,frame){
  const content=ReactDOM.renderToStaticMarkup(React.createElement(Platform,{id:s.id,f:frame}));
  await page.setContent('<html lang="zh-CN"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#e8eef7}#platform{position:absolute;left:36px;top:72px}</style><body><div id="platform">'+content+'</div></body></html>');
  await page.evaluate(()=>document.fonts.ready);
 }
 for(const s of scenes){
  await load(s,Math.round(s.sample*30));
  if(s.id==='lesson'){
   const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
   const doc=await cdp.send('DOM.getDocument');const node=await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'main section > div > div > div:nth-child(3)'});
   const fonts=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});fs.writeFileSync(path.join(out,'字体检查.json'),JSON.stringify(fonts,null,2));await cdp.detach();
  }
  const bad=await page.evaluate(()=>{
   const found=[];
   document.querySelectorAll('main,main section,aside').forEach(el=>{
    const rect=el.getBoundingClientRect();
    if(el.scrollHeight>el.clientHeight+3)found.push({type:'overflow',height:el.clientHeight,content:el.scrollHeight,text:el.textContent.slice(0,42)});
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
     const node=walker.currentNode;if(!node.textContent.trim()||node.parentElement.closest('svg'))continue;
     const range=document.createRange();range.selectNodeContents(node);
     const b=range.getBoundingClientRect();
     if(b.width>0&&(b.left<rect.left-2||b.right>rect.right+2||b.top<rect.top-2||b.bottom>rect.bottom+2))found.push({type:'text',text:node.textContent.slice(0,42),x:b.x,y:b.y});
    }
   });return found;
  });
  if(bad.length)issues.push({scene:s.id,bad});
  await page.screenshot({path:path.join(out,'界面-'+s.id+'.png')});
  const text=await page.locator('body').innerText();
  assert(!text.includes('\uFFFD'));
  if(s.id==='preferences')for(const label of ['判断依据','介入时机','支持起点','显示位置','控制方式','帮助后继续'])assert(text.includes(label));
  if(s.id==='explain')assert(text.includes('不改变附近的趋势。'),'解释应完整显示');
  if(s.id==='teacher')for(const n of ['01','02','03','04'])assert(text.includes('示例 '+n));
  if(s.click!==undefined){
   await load(s,Math.round(s.click*30));
   const [label,n]=selectors[s.id],locator=page.getByText(label,{exact:true}).nth(n);
   const box=await locator.boundingBox();assert(box,'找不到点击目标 '+s.id);
   targets[s.id]={x:Math.round(box.x+box.width*.6),y:Math.round(box.y+box.height*.55)};
   assert(targets[s.id].x<1880&&targets[s.id].y<1000);
  }
 }
 await browser.close();
 fs.writeFileSync(path.join(__dirname,'点击位置.json'),JSON.stringify(targets,null,2)+'\n');
 fs.writeFileSync(path.join(out,'布局检查.json'),JSON.stringify({scenes:scenes.length,targets,issues},null,2));
 console.log(JSON.stringify({scenes:scenes.length,targets,issues}));
 assert.equal(issues.length,0,'画面有文字溢出，请检查 output/v3/布局检查.json');
})().catch(e=>{console.error(e);process.exitCode=1});

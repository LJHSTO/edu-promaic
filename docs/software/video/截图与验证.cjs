const {chromium}=require(process.env.ZHIDIAN_PLAYWRIGHT_MODULE||'playwright-core');const fs=require('fs');const path=require('path');const assert=require('assert/strict');const{pathToFileURL}=require('url');
(async()=>{const root=path.resolve('docs/software');const out=path.join(root,'video/public');fs.mkdirSync(out,{recursive:true});const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const p=await b.newPage({viewport:{width:1600,height:900}});let shots=[];await p.goto(pathToFileURL(path.join(root,'walkthrough/index.html')).href);let prev=[800,450];async function shot(name,caption,selector,duration=6){await p.evaluate(()=>document.fonts.ready);const box=selector?await p.locator(selector).boundingBox():null;const target=box?[box.x+box.width/2,box.y+box.height/2]:prev;const index=shots.length;await p.screenshot({path:path.join(out,`screen-${index}.png`)});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);shots.push({name,caption,file:`screen-${index}.png`,duration,from:prev,target,click:!!selector});prev=target;if(selector)await p.locator(selector).click();}
await shot('进入课程','从课程首页，进入“函数值与极限”。','#enter',6);
await shot('学习工作台','左侧是课程路线，中间是活动，右侧是随时可用的帮助。','#prefTop',6);
await shot('帮助偏好','六个维度决定怎样获得帮助；学习过程中可以再调整。','#savePrefs',9);
await p.waitForTimeout(2300);await shot('课程讲解','先看本节讲解，分清点上的值与附近的趋势。','#lesson',4);
await shot('阅读概念','把概念放回具体活动，用操作检查自己的理解。','#goExplore',7);
await shot('独立尝试','先自己判断：x 趋近于 1，函数值趋近多少？','[data-choice="4"]',6);
await shot('提交判断','选择 4，提交这一次判断。','#submit',4);
await shot('可控介入','助手发现可能的混淆，先问你是否需要帮助。','#later',8);
await p.waitForTimeout(2300);await shot('暂缓帮助','可以先自己试，助手尊重这次选择。','#ask',5);
await shot('接受帮助','需要时再接受一条线索。','#accept',4);
await shot('等待可感知','查找本节材料时，页面显示当前状态。',null,2);await p.waitForTimeout(1200);await shot('线索与出处','先读提示，再展开它引用的课程材料。','#source',8);
await shot('来源可核对','来源带章节、段落和版本，随时可以回到原文。','#source',8);
await shot('动手观察','把实心点从 4 移到 5，比较附近的趋势。',null,4);
const slider=await p.locator('#point').boundingBox();shots.at(-1).from=[slider.x+slider.width/2,slider.y+slider.height/2];shots.at(-1).target=[slider.x+slider.width,slider.y+slider.height/2];shots.at(-1).drag=true;await p.locator('#point').focus();await p.keyboard.press('ArrowRight');prev=[slider.x+slider.width,slider.y+slider.height/2];
await shot('参数变化','单点变了，两侧仍趋近 2。数值和图形一起帮助判断。','[data-choice="2"]',7);
await shot('验证观察','把观察转成自己的答案。','#submit',4);
await shot('继续新题','当前题完成后，换一道同概念的新题。','#nextCheck',5);
await shot('独立检查','新题隐藏旧线索，这一次由学生独立判断。','[data-choice="3"]',8);
await shot('提交新题','选择 3，提交独立检查。','#submitCheck',4);
await shot('独立结果','独立答对与提示后完成分别记录。','#review',6);
await shot('学习回顾','回看帮助方式和独立表现，再决定下一轮怎么学。','#teacherNext',8);
await shot('教师概览','教师看见班级结果，也保留未完成会话的分母。','#filter',7);
await shot('查找卡点','筛选需要再练的会话，查看具体学习过程。','.replay',5);
await shot('过程回放','从误解、接受帮助到独立表现，定位课程可以改进的地方。','#publish',7);
await shot('课程调整','预览修改，再由教师确认发布。','#confirmPublish',6);
await p.waitForTimeout(2300);await shot('发布完成','一轮学习体验，连接学生探索与教师课程改进。',null,7);
// Explicit recovery path is verified in the interactive prototype; no fake backend success.
await p.locator('[data-page="learn"]').click();await p.locator('#backExplore').click();await p.locator('#ask').click();await p.locator('#accept').click();await p.waitForTimeout(1200);await p.locator('#retryDemo').click();assert(await p.locator('[role="alert"]').isVisible());await p.locator('#retry').click();await p.waitForTimeout(1200);assert(await p.locator('#source').isVisible());await p.locator('#prefTop').click();await p.keyboard.press('Escape');assert.equal(await p.locator('.modal-bg').count(),0);
await p.locator('[data-page="teacher"]').click();await p.locator('#filter').click();for(const [session,text] of [['示例 01','首次独立答对'],['示例 04','尚未开始独立检查'],['示例 03','新题仍需再练']]){await p.locator(`[data-session="${session}"]`).click();assert((await p.locator('.two > section').last().innerText()).includes(text));}
await p.locator('[data-page="learn"]').click();await p.setViewportSize({width:320,height:860});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:path.resolve('output/review/mobile.png'),fullPage:true});
assert.equal(shots.length,26);fs.writeFileSync(path.join(root,'video/story.json'),JSON.stringify(shots,null,2));console.log({screens:shots.length,seconds:shots.reduce((a,s)=>a+s.duration,0),recovery:true,mobile320:true});await b.close()})().catch(e=>{console.error(e);process.exitCode=1})

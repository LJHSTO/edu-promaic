# 原型完整体验视频源文件

成片：../media/原型完整体验.mp4，1920×1080，30fps，148 秒。无全程配音，包含操作提示字幕、分段音乐与点击/完成声效。

## 设计与素材

界面来自仓库内可交互样机，按实际按钮步骤截图；Film.tsx 在同一界面框架内呈现鼠标轨迹与点击反馈，story.json 保存每一步、文案、时长和目标位置。视频的原型场景均为设计样机示例，未连接生产模型和数据库。

画面按任务推进；26 步从进入课程到教师回看。可在 story.json 调整文字与相对时长，最终时间轴统一为 148 秒。原型介绍播放后补充 32 秒三层设计说明，技术架构另讲 2 分钟。

参考 [Linear Learn 的流程演示](https://linear.app/learn/building-with-your-users)中固定工作区和操作聚焦的方式：约 85 秒的客户请求输入画面仍保留侧栏、页面标题、取消和提交入口，观众能知道当前在哪里、正在做什么。参考 [Notion 教学页面](https://www.notion.com/help/guides/category/ai)按具体任务组织说明的方式。

用户提供的 EAC 参考片中，约 10、30、60 秒的界面演示采用窗口框架、鼠标操作和局部说明。本片保留这些有助于理解的元素，改为贯穿同一次学习任务的连续流程。参考画面均不进入成片；开场直接从课程首页操作开始。

## 复现

直接观看成片不需要安装依赖。重新渲染时，先按下方“配乐与声效”取得两首配乐并运行混音脚本，再在本目录运行 `npm ci`，随后运行 `npm run studio` 或 `npm run render`。依赖锁定在 package-lock.json。默认使用 Windows Chrome；其他环境修改渲染.cjs 中的浏览器路径。可设置 ZHIDIAN_VIDEO_MODULES 复用已安装的同版本 node_modules。

重新截取样机：在仓库根目录运行 `node docs/software/video/截图与验证.cjs`。需要已有 playwright-core，可用 ZHIDIAN_PLAYWRIGHT_MODULE 指定该模块的绝对路径；截图与验证只访问本地样机。

本机字体采用 Microsoft YaHei，截图已固化字形。仓库不分发系统字体。public/screen-*.png 是视频正式界面素材；临时检查和原始音乐在被忽略的 output/ 中。

## 配乐与声效

使用 Mixkit 的 Close Up（Michael Ramir C.，1167）和 Digital Clouds（Alejandro Magaña，175）。[官方曲目页](https://mixkit.co/free-stock-music/tag/corporate/)；[音乐许可](https://mixkit.co/license/modal/musicFree/)。仅在成片中使用，仓库不单独再分发原始或混合音乐文件。

进入与探索：Close Up 0—79 秒；独立检查：Digital Clouds 16—53 秒；教师回看：Close Up 52—86 秒。相邻段 1 秒交叉淡变，总时长 148 秒。进入与结尾淡入淡出，思考段降低电平；基础音乐目标 -24 LUFS。点击与轻提示由本项目合成，不使用系统品牌音效。

取得相应曲目后，放到仓库根目录 output/review/close-up.mp3、digital-clouds.mp3；设置 FFMPEG_PATH，运行 `python docs/software/video/混音.py`，生成 public/体验配乐.mp3。脚本依赖 numpy，输出声音事件.json。音乐源地址为 https://assets.mixkit.co/music/1167/1167.mp3 与 https://assets.mixkit.co/music/175/175.mp3。

本轮用户明确要求完整重做并提交仓库，按这一授权完成全片；开场和关键画面先抽帧核对。技术验收包括媒体解码、时长和音量测量，课堂设备实际听感由汇报前试听确认。

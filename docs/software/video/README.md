# 知点体验视频源文件

140 秒，1920×1080，30fps。[观看完整体验](../media/原型完整体验.mp4)。

## 画面与时间轴

视频沿着同一个工作台展开：进入课程 → 帮助偏好 → 概念讲解 → 作答 → 线索与出处 → 图形探索 → 自我解释 → 独立检查 → 学习回顾 → 教师回放 → 课程发布。

- `平台界面.tsx`：课程、助教、题目、图形、记录和教师页面。
- `场景.json`：15 个场景的时长、字幕、取样时点和关键点击。
- `Film.tsx`：画面组合、鼠标动作、封面与音轨。
- `界面检查.cjs`：检查文字是否被裁切，并按按钮位置生成点击坐标。
- `混音.py`：连续音乐和六处低音量点击声。
- `渲染.cjs`：导出图片、开场预览和完整视频。

页面由独立的界面组件绘制，文字与图形均可编辑。交互原型的操作记录仍由 `story.json` 和 `截图与验证.cjs` 保存，入口见[工作台](../walkthrough/index.html)。

## 配乐

使用 Francisco Alvear 的 **Dreamy Jazz**，从原曲开头连续播放至结尾。开场 2.8 秒留给进入操作；阅读与独立检查处用六秒渐变轻降音量，保持乐句连续。声音事件与时间见 `声音事件.json`。

[下载配乐](https://assets.mixkit.co/music/645/645.mp3) · [Mixkit Stock Music Free License](https://mixkit.co/license/modal/musicFree/)

配乐用于成片，原始音乐文件不随仓库分发。点击声由脚本合成。

## 编辑与导出

1. 将配乐保存为仓库根目录下的 `output/v3/dreamy-jazz.mp3`。
2. 设置 `FFMPEG_PATH`，运行 `python docs/software/video/混音.py`。需要 Python、NumPy 和 FFmpeg。
3. 在本目录运行 `npm ci`。依赖版本固定在 lockfile 中。
4. 运行 `node 界面检查.cjs`，检查布局并更新 `点击位置.json`。需要 playwright-core，可通过 `ZHIDIAN_PLAYWRIGHT_MODULE` 指定已安装模块。
5. 运行 `node 渲染.cjs --stills` 检查页面、点击位置和封面，再运行 `npm run render` 导出完整成片。

`npm run studio` 打开编辑预览；`node 渲染.cjs --preview` 导出前 18 秒。主合成为 Experience，Experience-NoSfx 仅保留配乐；各 Scene 合成可单独编辑，Cover 用于封面。

Windows 默认使用已安装的 Chrome。其他环境设置 `CHROME_PATH`，并安装支持中文的字体。正文使用 Microsoft YaHei UI，公式使用 Georgia。可通过 `ZHIDIAN_VIDEO_MODULES` 复用同版本依赖。

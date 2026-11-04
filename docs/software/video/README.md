# 知点体验视频源文件

124 秒，1920×1080，30fps。成片位于 [原型完整体验.mp4](../media/原型完整体验.mp4)。

## 编辑

`Film.tsx` 定义 16 个场景、时间轴和动效；`story.json` 保存交互原型的截图与操作位置；`声音事件.json` 保存音乐段落和音效时点。主合成是 Experience，每个 Scene 合成可单独预览，Cover 用于封面。Experience-NoSfx 保留音乐，便于比较声音。

画面使用遮罩文字入场、界面推近、局部聚焦、参数动画与状态切换。鼠标只出现在五个关键点击附近，单次移动约 0.3 秒。开场 5 秒和独立检查前的 5 秒留出音乐空白。

## 生成

1. 将下表三首配乐保存到仓库根目录 `output/v2/`，文件名依次为 groove.mp3、vastness.mp3、dry-gin.mp3。
2. 设置 FFMPEG_PATH，运行 `python docs/software/video/混音.py`。需要 Python、NumPy 和 FFmpeg。
3. 在本目录运行 `npm ci`，再运行 `npm run studio` 或 `npm run render`。依赖版本固定在 lockfile 中。Windows 默认使用已安装的 Chrome；其他环境设置 CHROME_PATH。

可设置 ZHIDIAN_VIDEO_MODULES 复用同版本依赖。重新截图时，在仓库根目录运行 `node docs/software/video/截图与验证.cjs`，使用已安装的 playwright-core，或通过 ZHIDIAN_PLAYWRIGHT_MODULE 指定模块路径。字体使用 Microsoft YaHei UI 与 Georgia。

## 音乐许可

| 曲目 | 作者 | 下载 |
|---|---|---|
| Gimme that Groove! | Michael Ramir C. | [872](https://assets.mixkit.co/music/872/872.mp3) |
| Vastness | Andrew Ev | [184](https://assets.mixkit.co/music/184/184.mp3) |
| Dry Gin | Michael Ramir C. | [868](https://assets.mixkit.co/music/868/868.mp3) |

音乐按 [Mixkit Stock Music Free License](https://mixkit.co/license/modal/musicFree/) 用于视频；原始音乐文件不随仓库分发。点击、切换、转场与完成声由混音脚本合成。

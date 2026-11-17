# 本地轻量视频渲染原型

借鉴 [`paipiange/dsh-video-workbench`](https://github.com/paipiange/dsh-video-workbench) 的
**HTML5 引擎**思路，实现的一条**完全本地、不依赖任何视频供应商**的轻量出片链路：

```
主题文案 ──▶ 生成自包含 HTML 动画 ──▶ 无头浏览器逐帧截图 ──▶ FFmpeg 合成 MP4
```

## 为什么这样做

参考项目的核心洞察是：**视频不是「AI 直接吐视频帧」，而是「AI 写代码 + 浏览器/FFmpeg 渲染」造出来的**。
这条链路不调用 Sora/可灵/Runway 等付费服务，纯本地可控，因此也**不违反本项目
AGENTS.md 中「视频生成仅实现明确占位、不得创建真实任务、不得调用供应商」的约束**——
本原型是独立脚本，不会注册到插件，也不会创建插件内的任务记录。

## 三个模块

| 文件 | 职责 |
|---|---|
| `template.ts` | 把标题/副标题/落款编译成确定性 HTML 动画，暴露 `window.__seekToFrame(n)` 与 `window.__totalFrames` |
| `renderer.ts` | 用 Edge/Chrome headless 通过 CDP 逐帧 `__seekToFrame` + `Page.captureScreenshot`，写出 MJPEG 流 |
| `encoder.ts` | MJPEG 流 → libx264 yuv420p + bt709 + crf19 + AAC，`+faststart` |
| `main.ts` | CLI 入口，串联三步 |

## 运行

```bash
node --experimental-strip-types scripts/video-prototype/main.ts \
  --title "拍片哥工作台" \
  --subtitle "本地轻量视频渲染原型 · 逐帧出片" \
  --footer "PAIPIANGE CREATIVE" \
  --duration 5 --fps 24 --width 1280 --height 720
```

产物输出到 `.artifacts/video-prototype/`：

- `index.html` — 动画模板
- `frames.mjpeg` — 逐帧截图流
- `output.mp4` — 最终成片

## 依赖

- Node ≥ 22（用原生 WebSocket 做 CDP）
- Edge 或 Chrome（无头渲染）
- FFmpeg / ffprobe（合成，脚本会自动在 PATH 或常见目录定位）

## 关键契约（与参考实现一致）

- 页面声明 `window.__totalFrames`，渲染器据此循环截图。
- 页面实现 `window.__seekToFrame(n)`，把动画精确定位到第 n 帧。
- 动画完全确定性（无 `Math.random`），保证逐帧可复现。
- 截图用 JPEG quality 90 + `optimizeForSpeed`，速度优先；全部帧写入单个 MJPEG 流，避免海量临时文件。

## 后续可扩展方向（对齐 dsh-video-workbench）

- AI 编码闭环：LLM 生成 HTML → 静态沙箱校验 → 3 轮自动修复（对应其 `ai-coder.js`）。
- 分段缓存：按分镜切分、复用已编码片段（对应其 `segment-cache`）。
- BGM 节拍踩点：FFmpeg 能量包络探测 BPM 驱动切镜（对应其 `beat-analyzer.js`）。
- Remotion 引擎：LLM 生成 TSX 矢量组件走 `@remotion/renderer`（较重，可选）。

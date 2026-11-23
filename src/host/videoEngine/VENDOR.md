# vendored dsh-video-workbench 引擎说明

本目录 `src/host/videoEngine/` 是从开源项目
[Merziller/dsh-video-workbench](https://github.com/Merziller/dsh-video-workbench)
（MIT License，作者 Merziller）vendor 进来的**本地视频渲染引擎**，供拍片哥工作台的
「Remotion 双引擎」视频生成能力复用。

## 版权与署名

- 引擎主体代码版权归原作者 **Merziller**（QQ: 1411574209 / 微信: Merziller /
  Gmail: k26789228@gmail.com），依据 MIT License 提供。
- 完整版权声明见 `NOTICE` 与 `LICENSE`（随 vendor 一起保留，**不得删除**）。
- 任何二次分发/修改必须保留原作者署名，详见 `NOTICE`。

## 目录结构（与原仓库 packages/ 一一对应，相对引用保持不变）

```
videoEngine/
├── packages/
│   ├── shared/               # 公共运行时：字体、硬件守护、字幕引擎、Remotion 解析、ffmpeg/browser 解析
│   ├── dsh-tool-video-suite/ # 双引擎逐帧渲染器（frame-renderer.js）+ QA + 场景缩略图
│   ├── dsh-tool-media/       # 大脑：pipeline-orchestrator / remotion-generator / html-generator / beat-analyzer / ai-coder
│   ├── dsh-tool-local-tts/   # 多引擎 TTS（IndexTTS-2.5 / GPT-SoVITS / Windows SAPI / Edge-TTS）
│   ├── dsh-tool-avatar/      # 数字人叠加引擎
│   ├── dsh-preset-video/     # 视频制作系统提示词
│   └── dsh-web-video-workbench/  # Web Studio（本项目未启用，仅保留）
├── templates/cinepulse-hub/  # 影核广场 MOTION.md 模板（5 个高频题材）
├── scripts/                  # TTS 安装/桥接脚本（install-tts-engine.mjs / tts-bridge.py / tts-server.py）
├── voice-packs/              # 音色库目录（catalog.example.json）
├── NOTICE / LICENSE
```

## 本地适配改动（vendor 后必须的 patch）

升级 vendor 时，**必须重新应用以下改动**（已记录，避免升级后路径解析失效）：

### 1. `packages/shared/index.js` → `resolveRemotionRuntime()`

原实现从 `PACKAGE_ROOT/node_modules` 往上只查两层。vendor 后引擎位于
`<插件包>/lib/videoEngine`，不在任何 node_modules 内，Remotion 运行时解析会失败。

已加「从 PACKAGE_ROOT 逐级向上查找含 `@remotion/renderer` 的 node_modules」兜底，
命中 pnpm 顶层软链 / 项目根 node_modules。

### 2. 引擎入口的 `PACKAGE_ROOT` / `REPO_ROOT` 解析

- `PACKAGE_ROOT = resolve(__dirname, '..', '..')` 现在指向 `videoEngine/` 目录本身，
  templates/scripts/voice-packs 均能正确定位（无需改动）。
- `REPO_ROOT` 因 `isDevWorkspace=false`，默认指向 `~/.dsh/video-workbench`（运行时
  工作区/配置/生成的临时工程放用户目录，符合隐私规范）。

### 3. `packages/shared/compliance.js` → `BUNDLED_FONTS_DIR` 支持环境变量注入

原实现 `BUNDLED_FONTS_DIR = resolve(__dirname, 'fonts')` 固定指向包内字体目录。
为配合「瘦包」——字体（约 9MB）不再打进 tarball，改为运行时按需下载——此处
让字体源目录可被 `PAIPIANGE_FONTS_DIR` 环境变量覆盖：

```js
export const BUNDLED_FONTS_DIR =
  process.env.PAIPIANGE_FONTS_DIR || resolve(__dirname, 'fonts')
```

桥接层 `src/host/videogen/remotionEngine.ts` 的 `ensureEngineFonts()` 会在出片前
把字体下载到本地缓存并注入该变量；未设置时行为与原版完全一致。

## 运行时依赖（Remotion 全家桶）

引擎通过 `resolveRemotionRuntime()` 动态定位以下 npm 依赖（已声明在拍片哥工作台的
`package.json` dependencies，由 dsh 的 pnpm 安装）：

- `@remotion/bundler` / `@remotion/renderer` / `@remotion/cli` / `@remotion/three`（4.0.542）
- `remotion`（4.0.542）
- `three`（^0.170.0）
- `@react-three/fiber`（8.18.0，必须固定 8.x，9.x 要求 react 19 会冲突）
- `react` / `react-dom`（^18.3.1）

## 调用入口

- 一站式出片：`packages/dsh-tool-media/index.js` 的 `produceFullVideo(options)`
- 分步编排：`produceFullVideo` 内部调用 `runMultiAgentPipeline(spec)`

拍片哥的桥接层在 `src/host/videogen/remotionEngine.ts`，通过 `import.meta.url`
向上定位本目录后动态 import。

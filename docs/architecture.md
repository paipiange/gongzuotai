# 架构说明（Architecture）

本文面向想快速上手代码结构的贡献者，说明拍片哥工作台（`dsh-paipiange`）的整体架构、关键模块与数据流。建议先读 [README](../README.md) 与 [install.md](./install.md) 了解产品定位与部署方式。

## 1. 总览

这是一个运行在 **DeepSeek Harness** 上的原生插件，采用经典 **Host / Client 双端**结构：

```
┌─────────────────────────────────────────────────────────────┐
│                     DeepSeek Harness                          │
│                                                               │
│  ┌──────────────────────┐        ┌────────────────────────┐  │
│  │   Host（Node/Electron）│        │  Client（浏览器 UI）    │  │
│  │   lib/index.js        │◄──────►│  lib/client.js         │  │
│  │                       │  HTTP  │                        │  │
│  │  · SQLite 持久化       │ /api/  │  · React 界面           │  │
│  │  · 生图/生文/视频引擎  │        │  · 状态管理             │  │
│  │  · 发布/导出服务       │        │  · 多平台适配           │  │
│  └──────────────────────┘        └────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

- **Host**：跑在 Electron 主进程里，负责所有「重活」——SQLite 持久化、调用生图/生文/视频后端、文件落盘、发布导出。API Key 等密钥只存在于 Host，不进入浏览器。
- **Client**：注入 Harness 的侧栏/布局，渲染 UI，通过 HTTP 调用 Host 提供的 `/api/paipiange.*` 接口。

源码目录：

```
src/
  host/           # Host 端（Node/Electron）
    index.ts      # 插件 apply() 入口，装配所有仓库/服务/路由
    api/          # webServer 适配 + 各路由（routes/ 下按资源拆分）
    storage/      # SQLite 仓库层（一个资源一个 Repository）
    imagegen/     # 生图后端适配（大模型 / ComfyUI）
    textgen/      # 生文服务（文本生成 / 拆页 / 选题推荐 / SSE）
    videogen/     # 视频双引擎（Remotion + ComfyUI 出帧）
    queue/        # 持久化生成队列
    publish/      # 微信发布服务
  client/         # Client 端（浏览器）
    index.tsx     # 侧栏注册入口（副作用脚本格式）
    app/          # 各页面组件 + 状态 + hostClient 封装
    styles.css    # 全局样式（暗色棕金主题）
```

## 2. 启动与装配（Host 入口）

`src/host/index.ts` 的 `apply()` 是唯一入口，大致流程：

1. 打开 SQLite（`PaipiangeDatabase.open`，含迁移）。
2. 实例化各 Repository 与 Service。
3. 幂等 seed 内置内容（模板/灵感/参考图/封面）。
4. 注册 `/api/paipiange.*` 路由到 Harness 的 `webServer`（`webServerAdapter` 负责 Node↔Fetch 桥接，`connection` 层做信任校验）。
5. 注册生成队列的处理函数（`registerGenerationHandlers`）。

> 关键约束：`better-sqlite3` 是原生 addon，其 ABI 必须匹配实机 Electron 版本。部署时用 `scripts/deploy.sh` 一键处理，不要手工 `pnpm install`。详见 [native-rebuild.md](./native-rebuild.md)。

## 3. 持久化层（storage/）

每个资源一个 Repository，统一操作 `PaipiangeDatabase` 里的表：

| Repository | 表 / 职责 |
| --- | --- |
| `CreationRepository` | 创作（文章/标题/图片/视频等）的 CRUD、搜索、软删、恢复、版本快照 |
| `AssetRepository` | 二进制素材（图片/上传）落盘到 `media/`，元数据记 `assets` 表 |
| `SettingsRepository` | `app_settings` 键值配置（生图/生文/微信/备份策略/轮播） |
| `TemplateRepository` | 创作模板 |
| `InspirationRepository` | 灵感选题 |
| `PublishRepository` | 待发布清单与发布历史 |
| `TaskRepository` | 后台生成任务 |
| `GraphicSessionRepository` | 图文会话（漫画分镜等） |
| `AnalyticsRepository` | 数据统计聚合 |

**安全要点**：所有 SQL 参数化；文件写入走 `paths.ts` 的 `resolvePrivatePath` 做路径穿越防护；`SettingsRepository` 里 API Key 只存 Host 侧，向 Client 返回的是脱敏后的摘要（`listBackendsWithSecrets()` 仅在 Host 内部使用）。

## 4. 多后端框架

生图与生文都抽象成「可配置后端」，用户可自由添加/切换：

- **生图**：`imagegen/` 下 `ImageGenService` 是门面，背后两个 provider：
  - `OpenAICompatImageProvider`：调用 OpenAI 兼容 images 接口（`baseUrl` + `apiKey` + `model`）。
  - `ComfyUIProvider`：提交 workflow → 轮询 `/history` → 拉取结果（本机 `http://127.0.0.1:8188`，支持 checkpoint 与分离式 unet/clip/vae 模型）。
- **生文**：`textgen/` 下 `TextGenService`，支持两种模式（见 `Backend.text` 类型）：
  - **Harness 模式**：`provider` + `model` 复用 Harness 的 `llm` 服务路由。
  - **直连模式**：`baseUrl` + `apiKey` + `model` 直连第三方 OpenAI 兼容 `/chat/completions`。

后端统一存于 `backends`（`Backend[]`），`BackendKind` 分 `llm-text` / `llm-image` / `comfyui`。每个后端可带一组模型（`models` 数组），前端通过「后端 + 模型」两级选择器（`GroupedModelPicker`）挑选，`model` 覆盖用于分组多模型。

## 5. 视频双引擎（videogen/）

视频生成支持两条本地链路，均不依赖付费文生视频供应商：

- **Remotion 引擎**：LLM 写 HTML/React 动画 → 本地渲染（`remotionEngine.ts` 动态 import `videoEngine/` 下 vendor 的双引擎源码）→ FFmpeg 合成，支持字幕、音乐、数字人与多引擎 TTS。
- **ComfyUI 出帧**：复用 Qwen-Image-Edit 图片模型 `layers` 多帧出序列 → FFmpeg 合成（`comfyVideo.ts`）。

> vendor 的 `src/host/videoEngine/` 是纯 ESM（含 `import.meta.url`、动态 import、`.py` 脚本、字体与模板），构建时必须按目录 copy（`copyVideoEnginePlugin`）、不能打进 bundle。

## 6. HTTP API 与数据流

路由在 `src/host/api/routes/` 下按资源拆分（`creations.ts` / `assets.ts` / `generation.ts` / `content.ts` / `publish.ts` / `graphic.ts` / `shared.ts`），统一挂到 `/api/paipiange.*`。

典型数据流（以「生成一张图」为例）：

```
Client（ImageGenPanel）
  └─> hostClient.generateImages(backendId, prompt, ...)
        └─> POST /api/paipiange.imagegen.generate
              └─> Host: buildImageGen() 按最新配置构建 ImageGenService
                    └─> provider.generate() 拿到字节
                          └─> AssetRepository.save() 落盘 + 写 assets 表
                                └─> 回写 sourceCreationId / 设为封面
```

Client 侧的 `hostClient.ts` 封装所有 fetch，带离线降级（Host 不可用时回退 localStorage 并显示全局离线横幅）。

## 7. 内置内容与 seed

`storage/builtinContent.ts` 用 `app_settings` 里的版本号做幂等 seed：

- `seedBuiltinContent`：内置模板 + 灵感（`builtin_content_version`）。
- `seedCoupleComicAssets`：情侣漫画三张固定参考图入库，并回填模板封面（`couple_comic_assets_version`）。
- 模板封面等静态资源放 `src/host/assets/`，构建时由 `copyAssetsPlugin` 原样拷到 `lib/assets/` 随包分发。

递增版本号即可追加下一批内置内容。

## 8. 测试

- Host 侧以「真实临时 SQLite」测试各 Repository（`storage/*.test.ts`）。
- 生图/生文/视频/队列均有单元测试。
- `harness.e2e.test.ts` 覆盖真实插件 `apply()` 的鉴权、路由、SQLite、队列重启恢复与发布导出。
- 前端关键纯函数（Markdown 渲染、模板工具、图片处理、粘贴）有独立测试。

运行：

```bash
pnpm typecheck && pnpm test
```

## 9. 约定与注意

- 提交前过 `pnpm typecheck && pnpm test`（CI 同样 gate）。
- 不提交密钥、个人信息、真实业务数据、数据库、上传素材、日志（见 [AGENTS.md](../AGENTS.md)）。
- 股票/涨跌配色遵循中文习惯：涨红跌绿。
- 中文引号在自然语言里正常使用，但代码与配置里只用 ASCII 引号。

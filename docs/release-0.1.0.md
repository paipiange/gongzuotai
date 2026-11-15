# Release 0.1.0

**拍片哥工作台（paipiange）** — 面向 DeepSeek Harness 的本地优先 AI 内容创作工作台，首个可分发版本。

## 发布产物

- 安装包：`dsh-paipiange-0.1.0.tgz`（仅含 Host/Client 产物 + patch + 文档，无源码与用户数据）
- 校验：`pnpm typecheck` / `pnpm test`（37 项）/ `pnpm build` 全绿
- 兼容：`@deepseek-ai/dsh@>=0.2.2-rc.1`，Node `>=20`

## 本版本亮点

1. **原生插件闭环**：Host（SQLite + API）/ Client（侧栏 + 工作台）双端，经官方 `webServer` + `connection` 服务接入。
2. **本地数据持久化**：草稿 / 素材 / 模板 / 灵感 / 发布清单全部落 SQLite，800ms 自动保存。
3. **文本生成**：文章/标题/营销/小红书四工作室接 Harness `ctx.llm`，SSE 流式逐字渲染；provider/model 运行时自动发现。
4. **生图能力**：OpenAI 兼容接口 + 本机 ComfyUI 双后端，handraw-style 370 风格库（小红书 / 公众号排版置顶）；支持参考图重绘（img2img）。
5. **导出与发布**：公众号 HTML / Markdown / ZIP 导出 + 小红书/知乎/头条平台适配文本导出。
6. **数据安全**：手动备份/下载快照；离线自动合并防丢失；封面缩略图；Markdown 编辑器；数据分析看板。

## 安装

```bash
pnpm add ./dsh-paipiange-0.1.0.tgz
# 在 Harness profile 中声明 bundle（见 cordis.patch.yml）
```

详见 [docs/install.md](./docs/install.md)。

## 发布流水线

- CI（`.github/workflows/ci.yml`）：每次 push/PR 跑 Node 20/22 矩阵 typecheck + test + build + 单 chunk 契约校验。
- Release（`.github/workflows/release.yml`）：打 `v*` tag 自动打包 tgz 并创建 GitHub Release 附带安装包。
- 本地一键打包：`pnpm release`（typecheck + test + build + 产出 `.artifacts/*.tgz`）。

## 已知限制

- 尚未在真实 Harness GUI 上完成截图回归（验收清单见 [docs/harness-acceptance.md](./docs/harness-acceptance.md)）。
- 视频生成仅为占位，不接模型。
- 第三方平台自动发布未实现（当前仅本地待发布清单 + 平台适配导出）。

## 完整变更

见 [CHANGELOG.md](./CHANGELOG.md)。

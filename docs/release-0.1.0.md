# Release 0.1.0

**拍片哥工作台（paipiange）** — 面向 DeepSeek Harness 的本地优先 AI 内容创作工作台，首个可分发版本。

## 发布产物

- 安装包：`dsh-paipiange-0.1.0.tgz`（134 KB，仅含 Host/Client 产物 + patch + 文档，无源码与用户数据）
- 校验：`pnpm typecheck` / `pnpm test`（25 项）/ `pnpm build` 全绿
- 兼容：`@deepseek-ai/dsh@>=0.2.2-rc.1`，Node `>=20`

## 本版本亮点

1. **原生插件闭环**：Host（SQLite + API）/ Client（侧栏 + 工作台）双端，经官方 `webServer` + `connection` 服务接入。
2. **本地数据持久化**：草稿 / 素材 / 模板 / 灵感 / 发布清单全部落 SQLite，800ms 自动保存。
3. **生图能力**：OpenAI 兼容接口 + 本机 ComfyUI 双后端，handraw-style 370 风格库（小红书 / 公众号排版置顶）。
4. **导出与发布**：公众号 HTML / Markdown / ZIP 导出，待发布清单状态流转。

## 安装

```bash
pnpm add ./dsh-paipiange-0.1.0.tgz
# 在 Harness profile 中声明 bundle（见 cordis.patch.yml）
```

详见 [docs/install.md](./docs/install.md)。

## 已知限制

- 尚未在真实 Harness GUI 上完成截图回归（验收清单见 [docs/harness-acceptance.md](./docs/harness-acceptance.md)）。
- 视频生成仅为占位，不接模型；文本模型流式调用未实现。
- 第三方平台自动发布未实现（当前仅本地待发布清单）。

## 完整变更

见 [CHANGELOG.md](./CHANGELOG.md)。

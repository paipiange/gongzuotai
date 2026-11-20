# 贡献指南（Contributing）

感谢你有意为拍片哥工作台（`dsh-paipiange`）做贡献！以下约定能让 PR 更快被 review 与合并。

## 先做这几件事

1. 读 [README](./README.md) 了解产品定位与已实现/边界。
2. 读 [docs/architecture.md](./docs/architecture.md) 了解代码结构。
3. 在动手前先开一个 issue 说明你要做什么，避免重复劳动或方向偏差。

## 环境准备

```bash
pnpm install
pnpm typecheck     # 类型检查
pnpm test          # 单元测试
pnpm build         # typecheck + 本地预览构建 + 插件构建
```

- 需要 Node ≥ 20，包管理器用 `pnpm`。
- 插件依赖 `better-sqlite3`（原生 addon），本地测试即可；实机部署 ABI 由 `scripts/deploy.sh` 处理（见 [native-rebuild.md](./docs/native-rebuild.md)），**不要手工 `pnpm install` 覆盖实机依赖**。

## 提交规范

- 提交前必须通过：`pnpm typecheck && pnpm test`。
- 一个提交只做一件事，保持小步、可独立回滚。
- Commit message 遵循 [Conventional Commits](https://www.conventionalcommits.org/)，例如：
  - `feat(imagegen): 支持分组多模型 model 覆盖`
  - `fix(templates): 空后端时模板中心不再报错`
  - `docs: 补充架构说明`
  - `test: 覆盖模板排序`
- 涉及行为变更时，同步更新 `CHANGELOG.md`（遵循 Keep a Changelog + 语义化版本）。

## 代码约定

- 中文环境，注释与用户可见文案用简体中文；代码标识符用英文。
- 自然语言里可用中文引号；**代码与配置里只用 ASCII 引号**。
- SQL 一律参数化，杜绝字符串拼接。
- 文件写入走 `paths.ts` 的 `resolvePrivatePath`，防止路径穿越。
- 密钥只存 Host 侧（`SettingsRepository`），绝不出现在 Client 代码、日志或 Git 历史里。
- 新增功能尽量配单元测试；Host 侧优先用真实临时 SQLite 测 Repository。

## 安全红线

- 不要提交：密钥 / API Key、个人信息、真实业务数据、数据库文件、上传素材、日志、本地敏感配置。
- 不要伪造 AI 生成结果：未配置模型时必须如实提示「需配置」，不能拿固定样例冒充。

## 提 PR 流程

1. fork 仓库，从 `main` 拉分支。
2. 开发 + 自测（`pnpm typecheck && pnpm test`）。
3. 更新 `CHANGELOG.md`（如适用）。
4. 提交并 push，发起 PR，描述清楚「做了什么 / 为什么 / 怎么验证」。
5. 等待 CI 通过与 review；CI 在 Node 20 / 22 矩阵下跑 typecheck + test。

不确定的地方，欢迎先在 issue 里讨论。

## 许可

贡献默认以本仓库的 [MIT](./LICENSE) 许可发布。

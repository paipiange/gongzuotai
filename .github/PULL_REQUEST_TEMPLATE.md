---
name: 提交 PR 前的检查清单
about: 发起 Pull Request 时使用
title: ''
labels: ''
assignees: ''
---

## 变更说明

请概括这个 PR 做了什么、为什么这么做。

## 变更类型

- [ ] 新功能（feat）
- [ ] 修复（fix）
- [ ] 重构（refactor，无行为变化）
- [ ] 文档（docs）
- [ ] 测试（test）
- [ ] 其他

## 自查清单

- [ ] 已通过 `pnpm typecheck`
- [ ] 已通过 `pnpm test`
- [ ] 已按需更新 `CHANGELOG.md`
- [ ] 已按需补充/更新测试
- [ ] 未提交任何密钥、个人信息、真实业务数据或日志（见 [AGENTS.md](../AGENTS.md)）

## 验证方式

说明你是如何验证这个改动的（命令、截图、手动步骤等）。

## 关联 issue

如有，请用 `Closes #<issue>` 关联。

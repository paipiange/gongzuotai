# 模板贡献指南（Templates）

拍片哥工作台的「模板中心」支持导入 / 导出 JSON 模板包。本文说明模板的字段结构与如何贡献模板。

## 模板 JSON 结构

一个模板包是一个 JSON 对象：

```json
{
  "kind": "paipiange-templates",
  "version": 1,
  "exportedAt": "2026-11-22T00:00:00.000Z",
  "templates": [
    {
      "category": "公众号",
      "name": "公众号深度推文",
      "description": "观点 + 论据 + 案例的深度长文结构。",
      "promptTemplate": "你是一位公众号深度内容写作者。请围绕「{{主题}}」撰写一篇深度推文。……",
      "fields": []
    }
  ]
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `kind` | string | 否（导出时自动带上） | 固定为 `paipiange-templates` |
| `version` | number | 否 | 模板包版本，当前为 `1` |
| `templates` | array | **是** | 模板数组，每项见下表 |

每个模板（`templates[]` 元素）：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | string | **是** | 模板名称，用于展示与搜索 |
| `promptTemplate` | string | **是** | 模板提示词，支持 `{{占位符}}` 语法 |
| `category` | string | 否 | 分类，默认「通用」；建议用「公众号 / 小红书 / 知乎 / 短视频 / 营销 / 漫画 / 科技 / 职场 / 生活 / 成长」等 |
| `description` | string | 否 | 一句话说明模板用途与风格 |
| `fields` | array | 否 | 结构化字段（当前内置模板多为空数组，预留扩展） |

### 占位符语法

`promptTemplate` 中使用 `{{字段名}}` 声明可变输入，生成时会提示用户填写。例如：

```text
你是一位小红书爆款种草笔记写手。请围绕「{{主题}}」，面向「{{目标人群}}」创作一篇种草笔记。……
```

内置模板常用占位符：`{{主题}}`、`{{话题}}`、`{{问题}}`、`{{产品}}`、`{{目标人群}}`、`{{主题/文案}}`。

## 一个完整示例

见 [templates.example.json](./templates.example.json)。

## 导入方式

1. 「模板中心」→「导入模板」，粘贴 JSON 或选择 `.json` 文件；
2. 也支持通过 API：`POST /api/paipiange.templates.import`，body 为 `{ "templates": [...] }`。

## 贡献模板

欢迎通过 Pull Request 向内置模板库（`src/host/storage/builtinContent.ts` 的 `BUILTIN_TEMPLATES`）或 `docs/` 下的示例集合贡献模板。要求：

1. **内容原创或可公开**：不使用受版权保护的他人文案，不编造数据。
2. **提示词清晰**：明确「角色 → 任务 → 要求 → 输出格式」，避免 AI 腔与套话。
3. **不涉及医疗 / 功效承诺**：不夸大功效，不写违法或违规内容。
4. **提交前自测**：用该模板跑一次生成，确认输出符合预期。

提交前请阅读 [CONTRIBUTING.md](../CONTRIBUTING.md) 与 [AGENTS.md](../AGENTS.md)。

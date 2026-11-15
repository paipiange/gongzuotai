# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 格式，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-11-15

首个可分发版本。原生插件入口、双端架构、本地数据闭环与生图能力全部打通。

### 新增

- Harness Host / Client 双端骨架与 `cordis.patch.yml`，侧边栏「拍片哥工作台」入口。
- 暖棕金国风全页面 UI：文章 / 图片 / 视频（占位）/ 标题 / 营销 / 小红书 / 素材 / 分析 / 发布 / 灵感 / 记录 / 设置。
- Host 侧 SQLite 持久化（9 表迁移），创作 CRUD / 搜索 / 软删除 / 恢复 / 版本快照 / 一致性备份。
- Host HTTP API（`/api/paipiange.*`），经官方 `webServer` 服务注册，`connection` 信任校验，Node↔Fetch 桥接层。
- 生图双后端：可配置 OpenAI 兼容接口 + 本机 ComfyUI（含 Qwen-Image-Edit 分离式模型实机验证）。
- handraw-style 风格库（370 视觉风格 + 170 排版图型 + 36 主题色），小红书 / 公众号排版置顶。
- 模板 / 灵感 / 发布清单读写，公众号 HTML / Markdown / ZIP 导出，素材上传与落盘。
- 草稿 800ms debounce 自动保存到 Host SQLite。

### 修复

- 侧边栏不显示：client bundle footer 改为返回干净的 `{ name, inject, apply }`，规避 `__esModule`/`default` 的 unwrapExports interop。
- 动态 import 触发的 code splitting 导致 chunk 加载失败：改为静态导入，client 产物保持单一 chunk。
- SQLite 关闭前 `wal_checkpoint(TRUNCATE)`，避免 WAL 文件锁导致的 EBUSY。

### 测试

- 25 个单元测试：存储 12 项、生图 6 项、发布打包契约 4 项、Node↔Fetch 桥接 3 项。
- 新增 GitHub Actions CI（Node 20/22 矩阵，typecheck + test + build + 单 chunk 契约 + 打包校验）。

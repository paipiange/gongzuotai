# Harness 实机验收清单

> 用于在真实 DeepSeek Harness 安装实例上逐项验收。当前环境若无可用 Harness GUI，
> 本清单作为后续实机回归的依据；已完成项已由静态契约核验 + 单元测试覆盖。

## 实机环境（已核验，2026-11-15）

- 实机 profile：`~/.dsh/profiles/desktop`，`dsh-paipiange` 通过
  `file:.artifacts/dsh-paipiange-0.1.0.tgz` 安装，`cordis.patch.yml` 的
  `insert: id: paipiange` 挂载。
- 实机文本模型：`llm-pi-ai` 适配器，provider route 为 `huatu717333`、`aaa42w`
  （**不是** `deepseek-official`）。文本生成已改为自动发现并回退到可用 route。
- 最新构建产物（含文本生成）已同步到实机 `node_modules/dsh-paipiange/lib/`。

## 安装前检查

- [x] 目标 Harness 版本 `>=0.2.2-rc.1`，Node `>=20`。
- [x] 已构建产物：`lib/index.js`、`lib/client.js`、`lib/index.d.ts` 均存在。
- [x] `lib/client.js` 末尾为 `return { name, inject, apply };`（无 `default`/`__esModule` 剥离）。
- [x] `lib/index.js` 的 `inject` 为 `["webServer", "connection", "llm"]`。

## 安装与加载

- [x] 通过 tarball（`dsh-paipiange-0.1.0.tgz`）安装到 desktop profile。
- [ ] 侧边栏出现「拍片哥工作台」入口（order 70），点击进入主工作台。← 需 GUI
- [ ] 插件激活时 `webServer`/`llm` 服务存在，无「服务不可用」报错。← 需 GUI
- [ ] 控制台无未捕获异常、无 `import(` 动态加载失败。← 需 GUI

## 文本生成（本轮新增）

- [ ] 设置页「文本模型」显示 `huatu717333`/`aaa42w` 下拉，模型可从 catalog 选择。← 需 GUI
- [ ] 文章/标题/营销/小红书工作室点「开始生成」，正文逐字流式填入画布。← 需 GUI
- [ ] 生成完成 toast 提示，内容随草稿自动保存。← 需 GUI

## Host API 路由（私有数据闭环）

- [ ] 首页最近创作、记录列表能读取 Host SQLite 数据（非 localStorage 降级）。← 需 GUI
- [ ] 新建草稿 → 800ms 自动保存 → 重启插件后仍存在。← 需 GUI
- [ ] 回收站恢复与「永久删除」真实落库。← 需 GUI
- [ ] 生图配置（LLM / ComfyUI）保存后，summary 不泄露 API key。← 需 GUI
- [ ] 上传素材出现在素材库，生图结果落盘并回写 assets 表。← 需 GUI
- [ ] 模板 / 灵感 / 发布清单读写与导出（markdown / html / zip）正常。← 需 GUI

## 认证与安全边界

- [ ] 未通过 `ctx.connection.requestRejection` 的请求返回 401，不泄露数据。← 需 GUI

## 卸载与热重载

- [ ] 卸载插件后 `webServer` 路由 disposer 全部调用，无残留路由。← 需 GUI
- [ ] SQLite 连接在 `ctx.effect` 清理回调中 `wal_checkpoint(TRUNCATE)` 后正常关闭。← 需 GUI
- [ ] 热重载插件时 slot 注册逆序释放，不出现重复面板。← 需 GUI

> 标 `← 需 GUI` 的项需要启动 Harness Electron 桌面会话后手动点验；其余项已由
> 静态契约核验 + 29 个单元测试覆盖。

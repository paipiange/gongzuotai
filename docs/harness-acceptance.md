# Harness 实机验收清单

> 用于在真实 DeepSeek Harness 安装实例上逐项验收。当前环境若无可用 Harness GUI，
> 本清单作为后续实机回归的依据；已完成项已由静态契约核验 + 单元测试覆盖。

## 安装前检查

- [ ] 目标 Harness 版本 `>=0.2.2-rc.1`，Node `>=20`。
- [ ] 已构建产物：`lib/index.js`、`lib/client.js`、`lib/index.d.ts` 均存在。
- [ ] `lib/client.js` 末尾为 `return { name, inject, apply };`（无 `default`/`__esModule` 剥离）。
- [ ] `lib/index.js` 的 `inject` 为 `["webServer", "connection"]`。

## 安装与加载

- [ ] 通过 tarball（`dsh-paipiange-0.1.0.tgz`）或 profile bundle 安装。
- [ ] 侧边栏出现「拍片哥工作台」入口（order 70），点击进入主工作台。
- [ ] 插件激活时 `webServer` 服务存在，无「服务不可用」报错。
- [ ] 控制台无未捕获异常、无 `import(` 动态加载失败。

## Host API 路由（私有数据闭环）

- [ ] 首页最近创作、记录列表能读取 Host SQLite 数据（非 localStorage 降级）。
- [ ] 新建草稿 → 800ms 自动保存 → 重启插件后仍存在。
- [ ] 回收站恢复与「永久删除」真实落库。
- [ ] 生图配置（LLM / ComfyUI）保存后，summary 不泄露 API key。
- [ ] 上传素材出现在素材库，生图结果落盘并回写 assets 表。
- [ ] 模板 / 灵感 / 发布清单读写与导出（markdown / html / zip）正常。

## 认证与安全边界

- [ ] 未通过 `ctx.connection.requestRejection` 的请求返回 401，不泄露数据。
- [ ] 无凭证 / 未连接时生图返回明确的「需配置」错误，不虚构成功。

## 卸载与热重载

- [ ] 卸载插件后 `webServer` 路由 disposer 全部调用，无残留路由。
- [ ] SQLite 连接在 `ctx.effect` 清理回调中 `wal_checkpoint(TRUNCATE)` 后正常关闭。
- [ ] 热重载插件时 slot 注册逆序释放，不出现重复面板。

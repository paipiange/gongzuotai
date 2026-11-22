# 第三方软件声明（Third-Party Notices）

本仓库（拍片哥工作台 / paipiange）在开发与运行时使用了下列第三方软件。我们在此列出其许可证，以示尊重与合规。若你在分发本软件或其衍生品，请一并保留相应许可证文本。

## 运行时依赖（dependencies）

| 包名 | 版本 | 许可证 | 说明 |
| --- | --- | --- | --- |
| [remotion](https://remotion.dev) 及 `@remotion/*`（bundler / cli / renderer / three） | 4.0.542 | **Remotion License（双重许可）** | 本地视频渲染引擎 |
| [react](https://reactjs.org) / [react-dom](https://reactjs.org) | ^18.3.1 | MIT | UI 框架 |
| [@react-three/fiber](https://github.com/pmndrs/react-three-fiber) | 8.18.0 | MIT | React 3D 渲染绑定 |
| [three](https://threejs.org) | ^0.170.0 | MIT | 3D 引擎 |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | 12.11.1 | MIT | SQLite 持久化 |
| [@deepseek-ai/cordis](https://www.npmjs.com/package/@deepseek-ai/cordis) | ^4.1.0 | MIT | DeepSeek Harness 插件框架 |
| [@phosphor-icons/react](https://github.com/phosphor-icons/react) | ^2.1.10 | MIT | 图标库 |
| [typescript](https://www.typescriptlang.org) | ^5.8.3 | Apache-2.0 | 类型系统 |

## 构建/测试依赖（devDependencies）

| 包名 | 许可证 |
| --- | --- |
| [tsdown](https://github.com/egoist/tsdown) | MIT |
| [vite](https://vitejs.dev) / [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) | MIT |
| [vitest](https://vitest.dev) | MIT |
| [@electron/rebuild](https://github.com/electron/rebuild) | MIT |
| `@types/*`（node / react / react-dom / better-sqlite3） | MIT |

## 关键说明

### 1. Remotion 采用双重许可（Remotion License，非纯 MIT）

`remotion`、`@remotion/bundler`、`@remotion/cli`、`@remotion/renderer`、`@remotion/three` 等包使用 **Remotion License**（见 `node_modules/remotion/LICENSE.md`），而非 MIT。要点：

- **个人**、**3 人及以下的营利性组织**、**非营利组织**、以及处于「评估阶段」的使用者，可免费用于商业或非商业视频制作。
- **3 人以上的营利性公司**需购买 **Company License**。
- 禁止复制或修改 Remotion 代码以**出售 / 出租 / 授权 / 再许可**你自己的 Remotion 衍生品。

> ⚠️ 本仓库通过 `dependencies` 声明了对 Remotion 的依赖，仅作为**调用方**使用其渲染能力，并未将 Remotion 源码直接打包或再分发。若你计划以营利性公司身份使用本工作台的视频渲染功能，请自行评估是否需要向 [Remotion](https://remotion.dev/license) 购买 Company License。

### 2. vendored 第三方代码

本仓库的 `src/host/videoEngine/` 为从 [dsh-video-workbench](https://github.com/Merziller/dsh-video-workbench)（MIT）vendor 进来的 Remotion + Three.js 渲染引擎源码。该目录在构建时被原样复制，属于第三方代码，MIT 许可要求保留原版权声明。相关维护说明见 `src/host/videoEngine/VENDOR.md`。

### 3. 许可证文本

各依赖的完整许可证文本位于 `node_modules/<包名>/LICENSE*`。分发二进制或再发布时，请保留上述许可证及其版权声明。

---

*本文档仅供参考，不构成法律意见。若你对许可证合规有疑问，请咨询专业法律人士。*

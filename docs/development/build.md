# 构建指南

本项目使用 pnpm、Vue、Tauri 2 和 Rust 构建。以下版本为当前开发环境与项目依赖的实际版本；更新依赖前应先确认其兼容性。

| 组件 | 当前版本 | 用途 |
| --- | --- | --- |
| Node.js | `v22.18.0` | 运行 Vite、Vue 类型检查与 Tauri CLI |
| pnpm | `12.3.4` | 安装与锁定前端依赖 |
| Rust / Cargo | `1.97.1` | 编译桌面端与执行 Rust 测试 |
| `@tauri-apps/cli` | `2.11.4` | 启动开发环境与生成发行包 |
| `tauri` | `2.11.5` | 桌面端运行时 |

## Windows 前置条件

安装 Node.js `v22.18.0`、pnpm `12.3.4` 和 Rust `1.97.1`。Windows 还需安装：

- **Microsoft C++ Build Tools**，并勾选 Desktop development with C++ 工作负载；
- **WebView2 Evergreen Runtime**。

安装完成后，在项目根目录验证工具链：

```powershell
node --version
pnpm --version
rustc --version
cargo --version
pnpm exec tauri --version
```

输出应分别包含 Node.js `v22.18.0`、pnpm `12.3.4`、Rust/Cargo `1.97.1` 与 Tauri CLI `2.11.4`。

## 安装依赖

首次克隆或依赖发生变更后，在项目根目录执行：

```powershell
pnpm install --frozen-lockfile
```

该命令严格使用已提交的 `pnpm-lock.yaml`，不会在安装时更新依赖版本或锁文件。只有明确要升级依赖时，才使用不带 `--frozen-lockfile` 的 `pnpm install`，并一并提交锁文件变更。

## 本地开发

启动完整桌面端开发环境：

```powershell
pnpm exec tauri dev
```

只调试 Vue 页面时，可启动 Vite：

```powershell
pnpm run dev
```

后者不会创建 Tauri 窗口，也无法验证 IPC、课程 WebView 或本地配置读写。

## 发布前检查

依次执行前端类型检查与生产构建、Rust 测试：

```powershell
pnpm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

确认通过后生成桌面端发行包：

```powershell
# 通用 Tauri 打包构建
pnpm exec tauri build

# 或使用 Windows 专用打包命令（自动同步版本并归档为 uxs-<version>-win-x64.exe）
pnpm run build:windows
```

构建产物位于仓库根目录的 `target/release/bundle/`（若使用 `build:windows` 则输出在 `src-tauri/target/release/`）。发布前至少安装并验证一次生成的安装包，确认开屏动画、课程 WebView 登录、模型配置保存和正常退出均可用。

## 本地数据

运行时会在应用工作目录的 `uxs-data` 下保存配置和日志。该目录已被 Git 忽略；提交日志或打包问题报告前，请检查其中是否包含 API Key、课程信息或其他敏感内容。

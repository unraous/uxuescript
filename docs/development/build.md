# 构建指南

本项目使用 pnpm、Vue、Tauri 2 和 Rust 构建。以下 Node.js 与 pnpm 版本与发布 CI 一致，Rust 为开发环境参考版本（CI 使用 stable），Tauri 版本来自项目依赖；更新依赖前应先确认其兼容性。

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

按上述版本安装时，输出应分别包含 Node.js `v22.18.0`、pnpm `12.3.4`、Rust/Cargo `1.97.1` 与 Tauri CLI `2.11.4`。

仓库的 `.cargo/config.toml` 对 `x86_64-pc-windows-msvc` 指定了 `lld-link.exe` 和 `target-cpu=x86-64-v3`。还需确保该链接器可用；生成的 Windows 程序要求支持 x86-64-v3 的处理器。

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

依次执行前端测试、类型检查与生产构建、Rust 测试及命令收集宏测试：

```powershell
pnpm test
pnpm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked -p uxs_commands
```

默认 Rust 测试跳过标记为 `#[ignore]` 的外部服务测试与长时间基准；不要在没有对应服务或凭据时追加 `--ignored`。

修改 IPC 命令或其 DTO 后，在仓库根目录运行：

```powershell
cargo sync-bindings
```

该 Cargo 别名运行 `sync-bindings` 二进制，通过 `tauri_specta` 导出 `src/services/cmds.ts`；普通构建只注册处理器，不执行 TypeScript 导出。`uxs_commands` 在编译期扫描 `src-tauri/src/commands/` 下的 Rust 文件；每个命令统一使用 `#[uxs_commands::command]`，同时生成 Tauri 命令与 Specta 绑定。`webview = "chaoxing"` 或 `webview = "mask"` 参数会将命令加入对应 WebView 的权限清单，未标注额外范围的命令只加入主界面清单。收集宏同步 `commands-main.json`、`commands-chaoxing.json` 和 `commands-mask.json`；不应手动在这些 allowlist 中增删命令。

确认通过后生成桌面端发行包：

```powershell
# 通用 Tauri 打包构建
pnpm exec tauri build

# 发布前从 src-tauri/Cargo.toml 同步版本，再生成 Windows MSI
pnpm sync:version
pnpm exec tauri build --bundles msi
```

构建产物默认位于 Cargo workspace 根目录的 `target/release/bundle/`，可执行文件位于 `target/release/`。设置 `CARGO_TARGET_DIR` 时以该目录为准。现有 `pnpm run build:windows` 虽会同步版本并执行 Tauri 构建，但其归档脚本仍查找 `src-tauri/target/release/uxuescript.exe`，与默认 workspace 输出路径不一致；不要将它视为当前可用的默认归档流程。

版本同步以 `src-tauri/Cargo.toml` 为源，更新 `package.json`、`tauri.conf.json`、Rust 元数据与注入脚本的版本提示。发布 CI 由 `v*` 标签触发：先在 Linux 运行前端和应用 Rust 测试，再构建 Windows MSI/便携 EXE 与 macOS ARM64 DMG，验证标签与 Cargo 版本一致，最后发布到 GitHub Release。CI 的便携 EXE 归档直接使用 `target/release/`，不调用上述 Windows 归档脚本。

发布前至少安装并验证一次生成的安装包，确认开屏动画、课程 WebView 登录、模型配置保存和正常退出均可用。

## 本地数据

默认数据目录为系统数据目录下的应用标识符 `top.unraous.uxs` 子目录（Windows 通常为 `%APPDATA%\top.unraous.uxs`），配置为 `config.toml`，日志在 `logs/` 下。只有无法取得系统数据目录时，才回退到工作目录的 `uxs-data`。已保存的配置也可包含自定义路径。

设置命令先修改内存配置；点击保存调用 `save_config`，正常窗口关闭也会尝试保存。配置读取或解析失败时回退默认配置；加载旧版本配置只更新版本元数据，不清空用户设置。API Key 的日志格式化输出会脱敏，但配置序列化保留明文；提交配置、日志或打包问题报告前，请检查并移除 API Key、课程信息或其他敏感内容。

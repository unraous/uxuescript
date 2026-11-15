# 开发与构建

## 环境

使用根目录 `.node-version` 指定的 Node.js，以及 [CI](../../.github/workflows/ci.yml) 中指定的 pnpm 版本。Rust 使用 stable，项目尚未声明 MSRV；Tauri 版本以项目依赖和锁文件为准。

Windows 还需安装 Microsoft C++ Build Tools（Desktop development with C++ 工作负载）和 WebView2 Evergreen Runtime。仓库的 [Cargo 配置](../../.cargo/config.toml) 指定 `lld-link.exe` 与 `target-cpu=x86-64-v3`，需确保链接器可用；生成的程序要求处理器支持 x86-64-v3。

在仓库根目录安装依赖并启动桌面端：

```powershell
pnpm install --frozen-lockfile
pnpm tauri dev
```

## 注入脚本

注入脚本源码位于 `injected/`：`entries.json` 声明产物名称与源码模块的对应关系，构建器通过 Vite 虚拟模块统一生成“导入并调用 main”的入口，无需维护入口 JS 文件。`chaoxing/` 保存依赖超星业务及 DOM 的适配，`utils/` 保存不依赖平台的工具，`runtime/` 保存 WebView 运行环境工具。源码通过 `import/export` 复用，JavaScript 使用 JSDoc 声明类型，统一由 Vite 打包。新增入口时修改映射；开发进程需重启以加载新增入口。

超星课程源码按 `course/ → chapter/ → tasks/` 组织，分别负责课程运行、章节页签和任务点；作业与考试入口位于 `chaoxing/`，共享题目处理及整页答题位于 `questions/`，考试跨页流程位于 `exam/paged.js`。作业默认整页，考试优先整卷预览，禁止预览时才走跨页流程。共享运行配置和无参 `cooldown()` 位于 `chaoxing/runtime.js`；课程进度报告和错误处理位于 `course/runtime.js`。业务函数直接导入所需能力，不额外传递上下文或创建工厂。

脚本按同名入口文件与目录并列组织，例如 `course.js + course/`、`course/chapter.js + course/chapter/`、`course/chapter/tasks.js + course/chapter/tasks/`。入口直接承载流程，不使用 `index.js` 或额外转导出包装。

跨目录引用使用 `@injected/` 别名，同目录使用相对路径。脚本构建与 Vitest 从 `scripts/script-aliases.mjs` 读取同一份别名配置，编辑器路径映射位于 `tsconfig.json`；别名在打包时解析，不会留在独立脚本中。
注入脚本、JS 测试及构建工具由根目录 `jsconfig.json` 管理，开启 `checkJs` 和 `noImplicitAny`，使用 JSDoc 声明具体类型；页面 API 的类型与使用它的模块放在一起，不新增 TypeScript 源码。`tsconfig.json` 负责 Vue/TypeScript 项目。`node scripts/typecheck.cjs --noEmit` 依次检查两者，`pnpm build` 与 CI 同样执行该检查。

脚本检查使用 `pnpm lint:scripts` 和 `pnpm fmt:scripts:check`，CI 同样执行这两项；格式修复使用 `pnpm fmt:scripts`。ESLint 对脚本使用普通 JavaScript 规则，并禁止跨目录相对导入；Prettier 沿用根配置，忽略生成的 `dist/` 产物。Zed 已配置保存时使用 Prettier，VS Code 的 JavaScript 保存格式化也使用 Prettier 扩展。

TypeScript 依赖采用双版本别名：`typescript` 指向提供编译器 API 的 TS 6，供 ESLint 和 Vue 检查器使用；`@typescript/native` 保留 TS 7 及其 `tsc` 命令。Vue 检查继续由 `scripts/typecheck.cjs` 执行。

内部脚本由本项目构建：`pnpm build:scripts` 调用 Vite 的构建 API，由 Rolldown 解析模块和合并依赖；不通过文本替换拼合源码。每个入口构建为独立 IIFE，压缩后输出到 `dist/scripts/embedded/`，供 Rust 内嵌。课程入口在同一次构建中额外输出 `dist/scripts/core.js` 和通过输出配置 `banner` 添加元数据的 `dist/scripts/uxuescript.user.js`；这两份公开产物关闭压缩，并由 Prettier 格式化，方便阅读和复制执行。监听模式同样更新全部产物。Rust 对内部脚本统一通过 `include_script!` 宏读取 `embedded/` 中的压缩产物，根路径基于 Cargo 内置的 `CARGO_MANIFEST_DIR`，不依赖调用文件的目录层级。

`pnpm tauri dev` 会启动 `pnpm dev`，后者在启动界面开发服务器前构建脚本，并通过 Vite 持续监听脚本及其依赖。Tauri 通过 `additionalWatchFolders` 监听 `dist/scripts/`；根目录 `.taurignore` 放行该目录，避免 `.gitignore` 中的 `dist` 规则阻止注册监听。脚本重新打包后触发 Rust 重编译并重启应用。修改监听配置后需重新启动 `pnpm tauri dev`。

`pnpm build` 先构建界面，再生成脚本，避免界面构建清理 `dist` 时删除脚本。直接执行 Cargo（包括 `cargo sync-bindings`）前，先运行 `pnpm build:scripts`。`dist/` 中的生成产物不作为源码维护。

外部脚本由独立项目维护和构建，交付产物保存在 `external-scripts/`。DeepSeek adapter 的 `deepseek-web-adapter.iife.js` 在独立项目执行 `pnpm build` 后，从其 `dist/` 原样复制到这里；主项目通过 `src-tauri/src/core/script.rs` 中的 `include_str!` 直接编译嵌入，不接入主项目的 Node 构建或 `dist/` 生成流水线。更新流程为独立构建 → 替换对应文件 → 重新编译主项目。`external` 表示维护归属，不表示业务重要性或安全隔离；编译嵌入本身也不会执行脚本。

当前 Tauri 未显式配置对 `external-scripts/` 的监听，更新外部产物后需手动重启 `pnpm tauri dev` 以重新编译。Cargo 对 `include_str!` 文件的依赖追踪不等同于 Tauri 的文件监听，不能据此假定开发进程会自动重启。

只调试 Vue 页面可运行 `pnpm dev`，但这不会创建 Tauri 窗口，不能验证 IPC、课程 WebView 或本地配置读写。

## 共享构建配置

版本、应用标识、更新端点和安装器共享数据在 [`config/build.json`](../../config/build.json) 维护，由 [`sync-config.mjs`](../../scripts/sync-config.mjs) 同步到 package.json、Cargo.toml、Tauri 配置和 MSI WXS。

这些目标文件仍是可编辑文件，各自维护依赖和非共享配置；共享字段以 `config/build.json` 为准，同步时会被覆盖。前端 dev、test、build 及 `pnpm tauri` 已包含同步步骤，直接运行 Cargo 前先执行：

```powershell
pnpm sync:config
```

## IPC 绑定与权限

这条管线以 Rust 命令声明为输入，与共享构建配置同步分开。命令使用 `#[uxs_commands::command]`；宏收集命令，注册 handler 并同步应用命令 allowlist，TypeScript 绑定导出到 `src/services/cmds.ts`。

修改命令或 DTO 后，在仓库根目录执行：

```powershell
pnpm sync:config
pnpm build:scripts
cargo sync-bindings
```

开发模式启动应用也会导出绑定。检查生成差异与本次声明是否一致，不手改绑定和 `commands-*.json`；WebView 能力与远程来源范围仍在 capabilities 中维护。

## 验证与打包

与共享 CI 一致的基础检查：

```powershell
pnpm test
pnpm build
cargo test --workspace --locked
```

前两步会同步构建配置。Rust workspace 测试包含命令宏 crate；默认跳过需要外部服务的用例。测试分组与按需联测见[测试说明](../../tests/README.md)。

生成桌面端发行包：

```powershell
pnpm tauri build
# 仅生成 Windows MSI
pnpm tauri build --bundles msi
```

默认安装包在 `target/release/bundle/`，可执行文件在 `target/release/`；设置 `CARGO_TARGET_DIR` 时以该目录为准。`pnpm build:windows` 在构建后从默认输出目录归档便携 EXE。

正式交付的标签、签名、镜像与安装验证见[发布指南](release.md)。

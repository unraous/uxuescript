# 测试说明

所有命令在仓库根目录运行。基础检查与共享 CI 一致：

```powershell
pnpm test
pnpm build
cargo test --workspace --locked
```

`pnpm build` 包含类型检查、前端生产构建和注入脚本打包。只需类型检查可运行 `node scripts/typecheck.cjs --noEmit`；直接执行 Cargo 前先运行 `pnpm sync:config` 和 `pnpm build:scripts`。

## 测试归属

| 位置 | 验证职责 |
| --- | --- |
| `tests/components/`、`layouts/`、`composables/`、`services/` | 前端组件与业务交互 |
| `tests/scripts/` | 普通 JS 用例直接导入 `injected/` 模块；跨 frame 隔离场景保留产物沙箱，`pnpm test` 自动先打包 |
| `tests/integration/` | 跨组件语言切换 |
| `tests/tooling/` | 配置同步与发布脚本 |
| `tests/updater/` | 更新模拟服务与[手动安装验证](updater/README.md) |
| 各 Rust crate 的 `tests/unit/` | 所属模块的单元测试，通过 `#[cfg(test)]` 与 `#[path]` 保留私有实现访问 |
| `src-tauri/tests/live/` | 真实模型服务、HTML 联测、Ollama 模型发现及百题计时 |

本地 mock 验证协议与错误处理，不能代替真实服务兼容性验证。Rust workspace 测试包含命令宏 crate，默认不会运行 `#[ignore]` 外部用例。

## DeepSeek B1：加载、绑定与只读诊断

B1 仅接通 debug 构建中的原生 `deepseek-debug` Window 与子 `deepseek` Webview，不接通题目求解。文档创建时，只在顶层且精确 `https://chat.deepseek.com` origin 中执行原样外部 IIFE；加载完成后执行内部 `deepseek-bootstrap`。JavaScript 唯一管理实例创建、初始化和清理；Rust 每轮用 `Webview::eval_with_callback` 读取同步 JSON 快照，不把异步工作的调度当作初始化完成。

指定本地检查：

```powershell
pnpm exec vitest run tests/scripts/deepseek-bootstrap.test.js
pnpm build:scripts
cargo test --manifest-path src-tauri/Cargo.toml -p uxuescript app::webview --locked --lib
```

源码 JS 用例使用受控 Promise 和模拟的公开 Adapter API，验证 await、拒绝、仅 `PAGE_NOT_READY` 的 10 秒/250ms 有界重试、同实例失败重试、重复入口、SPA 路径失效、快速 A→B→A、等待旧初始化及 owned dispose 后重新创建、外部实例不被接管、路径前缀大小写及销毁清理。原样外部 IIFE 的 VM 用例验证全局 API 作用域；Rust 用例验证交付条件块、同步 JSON 解析、诊断脱敏、观测代次、导航/关闭取消以及晚回调和超时。这些检查不是 WebView2、DeepSeek 真实 DOM 或登录验收；共享工作区生成/编译必须先协调时点，不与其他配置或绑定生成并行。

真实桌面验收须由操作者在已登录的调试窗执行，不自动认证、不发送 prompt、不调用模型：

| 场景                                         | 必须核对的事实                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 首页或不含 UUID 的路径                       | API 可存在，但快照为 `waiting_path` / `unbound`，不创建实例；不能由此断言已登录或未登录                                   |
| 已有 `/a/chat/s/<UUID>` 会话，空输入且未生成 | 初始化完成后为 `fulfilled` / `ready` / `valid`；不能把存在一个 Promise 或调用过 initialize 当作成功                       |
| 控件晚到或缺失                               | 可观察 `waiting_page`、`PAGE_NOT_READY` 和尝试数；10 秒后失败并保留错误，不能静默成功或无限重试                           |
| 非空输入、附件或已有生成                     | 保留相应初始化错误，不清空输入、不点击 Stop；手动处理后通过刷新或切换路径重新绑定                                         |
| SPA 切换及快速返回原路径                     | 同文档 JS history/popstate 变化后 Rust 必须继续采样；每次捕获的路径改变使旧绑定永久失效，等旧 await 和 owned dispose 收尾后 fresh create，旧结果不能恢复有效性 |
| 整页导航或刷新                               | 允许的原生 NavigationStarting 立即取消旧观测，不等 ContentLoading；被主机过滤拒绝的 URL 保留当前观测。旧回调不能发布新页状态，新文档仍走独立加载链 |
| 关闭调试窗                                   | 原生 Window 的 `Destroyed` 取消观测；在途 eval 回调晚到也不记录旧状态，不影响主窗口退出流程                               |

可在调试窗控制台同步读取 `globalThis.__UXS_DEEPSEEK_B1__.snapshot()`；其中 `initialization` 明确区分 `not_started` / `pending` / `fulfilled` / `rejected`。`generation` 是既有 JS 同文档失效代次，初始为 0，只在捕获路径变化或销毁时推进，重复读取不会推进。Rust 日志的 `document` 是宿主导航观测代次，`binding_generation` 是快照中的 JS 代次，两者不能混同；即使两次成功重绑的其余 `ready` 字段相同，JS 代次变化也会产生新的脱敏日志。`ready` / `valid` 已约束成功绑定代次等于当前 JS 代次，因此新代次的有效快照可以证明发生重新绑定。

默认 Adapter 的初始化通常很快，1 秒宿主采样可能跨过短暂的 `pending`，不要求每次都在日志中看到它。`valid` 只证明成功初始化的缓存 Session 与当前准确路径匹配，不证明认证或 DOM 此刻仍然就绪。Rust 只在诊断变化时记录日志，单轮读取最多等待 2 秒；日志不得包含 UUID、含 UUID 的完整 URL、认证信息、输入或对话内容。

## 按需外部联测

先查看可用入口，再配置对应服务与凭据（`.env` 或环境变量），只运行所需用例：

```powershell
pnpm sync:config
cargo test -p uxuescript live_tests -- --ignored --list
cargo test -p uxuescript test_solve_bigmodel -- --ignored --nocapture
```

百炼用例为 `test_solve_bailian`，从 `DASHSCOPE_API_KEY` 读取北京地域密钥；以同样方式按需运行。
硅基流动用例为 `test_solve_siliconflow`，从 `SILICONFLOW_API_KEY` 读取中国站密钥。

未实际请求外部服务时，只报告本地验证结果；不要将编译或入口列出成功表述为联测通过。

## 查看提示词

```powershell
pnpm sync:config
pnpm build:scripts
cargo test -p uxuescript preview_folio_prompt -- --ignored --nocapture
```

该用例使用作业卷面样本，按每批最多 5 题组装并打印系统提示词及用户内容，不请求模型服务。输出是协议编码前的提示词；具体接口还会附加对应的输出格式约束。样本没有图片，因此不会下载或打印图片数据。

## 增补测试

`tests/fixtures/chaoxing/` 保存用户提供的真实单选、连线题 HTML 节选，去除身份信息及无关页面区域。`tests/scripts/questions.test.js` 检查题目提取和选项点击，尤其覆盖连线题显示编号与内部 `data` 标识不同，以及公式元数据解码和普通图片占位的情况。样本未包含下拉框处理脚本，因此这些用例不验证页面脚本更新隐藏答案或服务端暂存。

同一 JS 用例还读取 `src-tauri/tests/assets/course-page/webpage.html.gz`，用章节测验选择器核对题目列表与字体原始字节。Rust 命令测试分别覆盖 `Folio` 无字体直传和有字体解密后求解；解密测试及求解联测直接读取题目 JSON 与字体样本，不再解析 HTML。

`exam-preview.html` 节选考试预览页的乱序单选、多选、两个共用选项题组和五空分录题，去除平台脚本及编辑器工具栏等无关内容；不代表完整试卷归档。`tests/scripts/exam-preview.test.js` 检查题后表单边界、卷名、公共选项及图片归属、子题选择隔离、五空填写和缺项拒绝，并用构造的单编辑器场景验证论述题。选项切换、IPC、UEditor 和逐空保存均使用本地模拟，不验证平台请求、暂存和评分。

`tests/scripts/folio.test.js` 验证结构化卷面解析。`webpage3.html.gz` 保存用户提供的完整作业 DOM 和页面脚本，账号及签名值已脱敏；测试以静态文档读取，不执行其中脚本。对应的 `folio.json` 同时作为 JS 解析期望与 Rust `Folio` 反序列化样本，覆盖三个分区、两篇阅读材料、十个单选子题、十空填空及翻译题。旧章节和考试样本用于验证题干、选项、字体及分区归属；章节结果页通过保留的空位容器读取空数。附加图片用例检查材料和子题的图片分别保存。

`tests/scripts/folio-flow.test.js` 使用完整作业样本和模拟 IPC、UEditor，验证卷面与课业背景发送、乱序答案按题号定位、十空逐项写入、阅读子题选项隔离以及翻译填写；填空答案少项、多项或空项时不写入该题的空位。Rust 批处理和 prompt 用例验证嵌套材料、拆批保留全文、按题型去重及固定排列。三种模型协议的本地 HTTP mock 使用同一卷面样本核对实际请求，并验证错误空数触发批次重试。这些测试不调用真实模型，也不验证平台保存或服务器评分。

测试沿被测职责组织，场景专属数据、mock 和断言留在用例附近。公共支持只收拢真实复用的机制：Rust 的 `src-tauri/tests/unit/support.rs` 与 `support/` 提供 HTTP 模拟，固定样本在 `src-tauri/tests/assets/`。

测试清理自己创建的资源，预期样本只读。新增本地用例不应删除或替代已有外部联测。

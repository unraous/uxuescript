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

B1 将 `deepseek` 按需创建在主 `app` Window 中，移除了独立调试窗。Native 启动不创建，DeepSeek 配置启动或选择时异步预加载；生成入口仍会等待创建和后台归位。切换 Native 保留页面，不支持独立销毁重建。文档创建时，只在顶层且精确 `https://chat.deepseek.com` origin 中执行原样外部 IIFE；加载完成后执行内部 `deepseek-web-bootstrap`（源码 `injected/deepseek-web/bootstrap.js`）。JavaScript 唯一管理 Adapter 实例创建、初始化和清理；Rust 每轮用 `Webview::eval_with_callback` 读取同步 JSON 快照，不把异步工作的调度当作初始化完成。

Rust 聚合用例还覆盖完整创建归位的并发串行、原生层级失败重试、课程区共用几何、DeepSeek 可创建但禁止独立销毁、未绑定回滚阻止旧回调、已绑定回滚粘性拒绝重建及正常 app 退出。最终层级应为 `mask > chaoxing-mask > chaoxing > deepseek > main`。这些用例不证明 Windows WebView2 遮挡后的真实后台生成行为；页面加载、已有 Session、遮罩、放大缩小及最大化恢复须另行桌面验收。

两个实际生成入口在源码中消费 `ensure` 返回的同一实例状态。创建聚合用例验证唯一 Arc、尚未提交创建才可释放槽、原生 close 派发后仍禁止下一代、未绑定 close 失败的同 Attempt 恢复，以及 bound 回滚的宿主终结限制。FSM 用例验证 Ready → Closing 不可逆、重复关闭共享结果、取消等待者不破坏终结，以及 LocalDrained 不释放原生所有权。`solvers` 用例验证取消创建调用者后仍完成归位、Ready ensure 不再归位、Closing ensure 立即拒绝、Destroyed 唤醒排队 ensure，并在本地终结前等在途创建退出。

B3-A 的本地生成完成证据覆盖最外层 Future 的 Flight Drop；请求槽清空并不被当作 Future 已退出。observe 用例追踪多个任务，验证关闭后不再登记、退出通知、超时保留未完成任务，以及 panic/cancel 不能报告成功。`WebSolverViews::current_attempt → begin_close → Attempt::drain_local` 是内部接口，无新增 Tauri 命令；Failure 的显式 retry_cleanup 仅重试本地清理。上述受控用例不证明 WebView2/WKWebView 原生退役、真实 Session 或后台生成已通过，也不开放独立销毁或重建。

指定本地检查：

```powershell
pnpm exec vitest run tests/scripts/deepseek-bootstrap.test.js
pnpm build:scripts
cargo test --manifest-path src-tauri/Cargo.toml -p uxuescript app::webview --locked --lib
```

源码 JS 用例使用受控 Promise 和模拟的公开 Adapter API，验证 await、拒绝、仅 `PAGE_NOT_READY` 的 10 秒/250ms 有界重试、同实例失败重试、重复入口、SPA 路径失效、快速 A→B→A、等待旧初始化及 owned dispose 后重新创建、外部实例不被接管、路径前缀大小写及销毁清理。原样外部 IIFE 的 VM 用例验证全局 API 作用域；Rust 用例验证交付条件块、同步 JSON 解析、诊断脱敏、观测代次、导航/关闭取消以及晚回调和超时。这些检查不是 WebView2、DeepSeek 真实 DOM 或登录验收；共享工作区生成/编译必须先协调时点，不与其他配置或绑定生成并行。

真实桌面验收须由操作者在 app 窗口内的 DeepSeek WebView 执行，不自动认证、不发送 prompt、不调用模型；选择 DeepSeek Web 后只读检查登录，确认未登录时显示登录引导，已登录后通过左侧辅助按钮查看。首次登录自动返回、原保存按钮、显示、焦点、遮罩及后台运行按[Windows 手动验收清单](manual/webview-switching.md)检查：

| 场景                                         | 必须核对的事实                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 首页或不含 UUID 的路径                       | API 可存在，但快照为 `waiting_path` / `unbound`，不创建实例；不能由此断言已登录或未登录                                   |
| 已有 `/a/chat/s/<UUID>` 会话，空输入且未生成 | 初始化完成后为 `fulfilled` / `ready` / `valid`；不能把存在一个 Promise 或调用过 initialize 当作成功                       |
| 控件晚到或缺失                               | 可观察 `waiting_page`、`PAGE_NOT_READY` 和尝试数；10 秒后失败并保留错误，不能静默成功或无限重试                           |
| 非空输入、附件或已有生成                     | 保留相应初始化错误，不清空输入、不点击 Stop；手动处理后通过刷新或切换路径重新绑定                                         |
| SPA 切换及快速返回原路径                     | 同文档 JS history/popstate 变化后 Rust 必须继续采样；每次捕获的路径改变使旧绑定永久失效，等旧 await 和 owned dispose 收尾后 fresh create，旧结果不能恢复有效性 |
| 整页导航或刷新                               | 允许的原生 NavigationStarting 立即取消旧观测，不等 ContentLoading；被主机过滤拒绝的 URL 保留当前观测。旧回调不能发布新页状态，新文档仍走独立加载链 |
| 关闭 app 窗口                                 | 原生 Window 的 `Destroyed` 取消观测并最终 detach；在途 eval 回调晚到也不记录旧状态；切回 Native 不执行此清理                |

可在 DeepSeek WebView 控制台同步读取 `globalThis.__UXS_DEEPSEEK_B1__.snapshot()`；其中 `initialization` 明确区分 `not_started` / `pending` / `fulfilled` / `rejected`。`generation` 是既有 JS 同文档失效代次，初始为 0，只在捕获路径变化或销毁时推进，重复读取不会推进。Rust 日志的 `document` 是宿主导航观测代次，`binding_generation` 是快照中的 JS 代次，两者不能混同；即使两次成功重绑的其余 `ready` 字段相同，JS 代次变化也会产生新的脱敏日志。`ready` / `valid` 已约束成功绑定代次等于当前 JS 代次，因此新代次的有效快照可以证明发生重新绑定。

默认 Adapter 的初始化通常很快，1 秒宿主采样可能跨过短暂的 `pending`，不要求每次都在日志中看到它。`valid` 只证明成功初始化的缓存 Session 与当前准确路径匹配，不证明认证或 DOM 此刻仍然就绪。Rust 只在诊断变化时记录日志，单轮读取最多等待 2 秒；日志不得包含 UUID、含 UUID 的完整 URL、认证信息、输入或对话内容。

## DeepSeek B2：单请求与完整终态

B2 不接入 Quiz、Folio 或 Router，也不在启动、绑定或采样时发送请求。debug 构建的 `deepseek_generate_text` 仅允许实际本地 `main` Webview（同时核对标签、父窗口及本地页面来源）；无远程 DeepSeek capability。操作者在本地 main DevTools 中显式调用后，Rust 单请求状态生成唯一 requestId，bootstrap 从同一同步段中的 owned Adapter `getSession()` 取绑定 Session，再调用 `generate()`。Rust 不传 UUID。

控制器沿 B1 增加 `bindDocument / start / read / cancel / ack`，仍唯一拥有 Adapter 生命周期；`snapshot()` 不驱动请求。请求身份为宿主文档 token、JS binding generation 与 requestId。同身份重复 start 只确认原请求，完整终态存于唯一 JS 内存槽，直到 Rust 同步轮询读到结果并 ack；没有队列或自动重试。Rust 通过 `eval_with_callback` 每次只读同步返回，单 callback 2 秒、终态轮询 250ms，总等待为 Adapter timeout 加短传输宽限。

诊断接受 `text`，可选 `timeoutMs`（默认 120000，范围 1000..600000）、`thinking`、`webSearch`。省略两种开关保持网页当前设置，不隐式传 false。返回 `completed` 的完整 `content`，或者原 `failed / uncertain / rejected` 的结构化错误；Promise reject 的非枚举 Error.message 也显式交付，仅本地调用者可读，不自动记录 prompt、回答、Session UUID 或上游异常正文。诊断日志只含请求身份、固定状态及内容字节数；`stage=start_dispatched` 仅表示宿主调度，同一 requestId 的 terminal 摘要用于关联，不把调度日志当成远端已确认发送。诊断沿现有管线正常注册，非 debug 构建在命令入口明确拒绝，不扩展生成宏。

在已登录、已有 UUID 会话且 B1 ready/valid 的前提下，由操作者在 main DevTools 执行（示例中的 text 须由操作者决定；不要在 DeepSeek 远程页 invoke）：

```js
await window.__TAURI_INTERNALS__.invoke("deepseek_generate_text", {
  text: "请只回复 B2-OK。",
  timeoutMs: 120000,
  thinking: false,
  webSearch: false,
});
```

验收核对完整回答与网页正式回答一致，同一时刻第二次调用被 BUSY 拒绝，以及在途 SPA、刷新或关闭立即结束，晚结果不能作为当前结果交付。`uncertain` 或已调度请求后 transport 失联、导航、宿主超时返回明确中断且应用生命周期内隔离后续发送；取消本地等待或调用 Adapter.cancel **不保证远端已停止**。操作者必须自行检查网页、必要时手动停止，再重启应用；无隐式 reset、fallback 或 resume。未发送的普通 failed 不改变其真实语义。

定向 `deepseek-bootstrap.test.js` 保留 B1 的 27 个用例，B2 仅增加 4 个核心场景：完整结果/去重关联、failed/uncertain 与隔离、Promise reject/SDK 关联、SPA 中断/晚结果。Rust 保留 B1 18 个用例，并合并 3 个 B2 场景验证单请求与安全 JSON、完整终态关联、导航及 sticky 隔离。这些 mock/本地状态验证不代表真实 Adapter DOM 或 WebView2 生成通过；真实桌面生成由操作者单独验收。

## DeepSeek B3：纯文本卷面求解

B3 将原 `solve_questions` 的 Web 分支接入 B2 文本生成，不新增诊断命令、界面、学习通提取或回填实现。客户端仍传 `payload: Folio` 与 `allowPartial: boolean`，返回同一 `AnswerItem[]`（`index / explanation / content` 均为字符串）。Native 原配置、三协议、字体还原与 `allow_partial` 语义不变；Web 不读取 Native 提供商或模型。

第一版只接受整卷无图片的输入：材料与题目图片在第一次发送前检查，所有批次沿原材料链、题型规则预组装完成，之后串行生成。只解析 `completed` 的严格 JSON 数组或 `{ answers }`；不摘取代码块或修复格式，不 retry，不回退 API。Web all-or-nothing，即使 `allowPartial: true`，任一批次失败也不返回部分答案给回填。首次批次固定文档与 JS 绑定，批间刷新或换会话直接停止；B2 BUSY 和应用生命周期 quarantine 不绕开、不 reset。省略 thinking/webSearch 保留网页开关，默认 timeout 120 秒。

定向验证（已有脚本产物可直接复用）：Windows MSVC 的 library unit test 不继承 Tauri 仅给 bin 链入的 Common Controls v6 `resource.lib`；本 crate 的 `build.rs` 为库测试请求 rustc 自动嵌入 v6 manifest，并以后发的 bin-only `/MANIFEST:NO` 保留 Tauri 原清单，避免两份 `MANIFEST 24/1/1033` 资源冲突。

```powershell
cargo test --manifest-path src-tauri/Cargo.toml -p uxuescript core::quiz::web::deepseek::tests --locked --lib
cargo test --manifest-path src-tauri/Cargo.toml -p uxuescript commands::chaoxing::tests --locked --lib
cargo test --manifest-path src-tauri/Cargo.toml -p uxuescript app::webview --locked --lib
pnpm exec vitest run tests/scripts/deepseek-bootstrap.test.js
```

三个合并核心场景验证真实 Prompt 管线、材料引用与乱序 JSON 恢复；后批格式错误/uncertain 不重试也不返回部分答案；整卷后段题图、材料图与不支持题型在发送前拒绝。命令用例继续验证 Web 不访问 Native 配置或 API、空卷校验，以及 Native 三协议正常入口。受控生成只替代网页请求，不替代实际批处理、Prompt 或答案解析；这些本地验证不能证明真实 DOM、模型格式或学习通回填。

设置面板显示“DeepSeek Web 已接入 · 开发预览”的静态能力说明，不表示实时连接或就绪状态。DeepSeek 页面在主 app 窗口后台按需加载并复用已有登录状态；生成前须有有效会话，保持输入框为空、无附件且未在生成。左侧认证引导和页面查看独立于保存，切回课程保留页面和后台任务；无需 Native API Key，仅支持纯文本，真实学习通回填尚未完成验收。`tests/components/TheSolverPanel.test.ts` 核对原中英提示、保存事件、认证四态、一次性自动返回及旧检查失效；`deepseek-authentication.test.js` 验证官方身份接口的归一化、超时和凭据变化，Rust 用例检查导航代次隔离。这些受控结果不代表真实账号登录或自动隐藏已通过。

真实验收须在已登录、已有 UUID 会话且 B1 ready/valid 的前提下，由操作者明确选择现有 DeepSeek Web 求解方式。也可由操作者在同一**本地 main** DevTools 显式选择并调用原命令（不是远程 DeepSeek 页）：

```js
await window.__TAURI_INTERNALS__.invoke("set_solver", { kind: "deep_seek_web" });
await window.__TAURI_INTERNALS__.invoke("solve_questions", {
  payload: {
    entries: [{
      type: "question",
      data: {
        id: "1", kind: "单选题", stem: "中国的首都是？",
        options: ["A 北京", "B 上海"], blank_count: null, images: [],
      },
    }],
    font: null,
    context: {},
  },
  allowPartial: false,
});
```

成功应返回一个 `AnswerItem`，`index` 为 `"1"`、`content` 为 `"A"`，`explanation` 为模型实际说明；核对网页只发送一次及 B2 完整终态、B3 `batch_parsed answers=1` 日志。这个合成单题证明 Folio→Prompt→网页生成→严格解析的 Rust 闭环，不证明学习通实际回填。后者需要操作者自备可安全测试的**纯文本**练习/作业页，通过原业务入口核对题号、选项或文本编辑器；不自动提交，也不能把暂存、服务器评分与填写等同。若暂无真实任务页，应明确记录这项验收未知，不宣称完整回填通过。

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

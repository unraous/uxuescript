# 架构概览

uXueScript 由 Vue 前端、Tauri/Rust 后端和课程 WebView 组成。课程自动化逻辑保留为独立的 `core.js` 文件，可由桌面端注入，也可直接复制到浏览器控制台执行。

```mermaid
flowchart TB
    %% 外部服务与模型生态
    subgraph External["外部服务与模型生态"]
        CXServer["超星学习通服务器<br/>(mooc1 / mooc2 / passport2)"]
        LLMCloud["各大 LLM 供应商 API<br/>(DeepSeek / OpenAI / Gemini / 智谱 等)"]
        OllamaLocal["本地 Ollama 服务<br/>(http://localhost:11434)"]
    end

    %% 前端展示与交互层
    subgraph Frontend["前端展示与交互层 (Vue 3 + TS)"]
        MainView["主控制面板 (TheMainPage.vue)<br/>- 课程看板、控制栏与配置面板"]
        MaskView["动画遮罩层 (TheMaskPage.vue)<br/>- 启动开场动画与淡出退出"]
        SpectaClient["类型安全 IPC 客户端 (cmds.ts)"]
    end

    %% Rust / Tauri 2 宿主与调度核心
    subgraph Backend["Rust / Tauri 2 宿主与调度核心"]
        MacroHandler["统一命令与权限宏 (uxs_commands)"]
        WindowEngine["窗口几何管理 (app::window / webview)<br/>- 齐次比例自适应布局与历史栈"]
        RouteEngine["页面分类与脚本调度 (core::url / script)<br/>- 页面特征识别与动态 eval 注入"]
        ConfigStore["纯 DTO 配置管理 (config)<br/>- API Key 脱敏与运行参数持久化"]
        FontParser["字体逆向引擎 (typr.rs 与 mapper.rs)<br/>- TTF 轮廓解析与码表哈希还原"]
        LLMDispatcher["LLM 并发分发器 (dispatcher.rs)<br/>- 题目切片、信号量限流与 429 重试"]
    end

    %% 内嵌课程运行环境
    subgraph WebviewContext["内嵌课程运行环境 (Webview: 'chaoxing')"]
        CoreEngine["core.js 自动化引擎 (自包含单文件)"]
        StateGuard["后台运行与失焦守护<br/>- 拦截失焦打断并保持聚焦活跃态"]
        DOMWalker["DOM 穿透探测器<br/>- 章节树遍历与多层嵌套 iframe 穿透"]
        TaskPipeline["任务执行步进器<br/>- 视频倍速锁定、PDF 滚动与富文本答题"]
        CourseDOM["超星课程页面 DOM"]
    end

    %% 通信与数据流向
    MainView --> SpectaClient
    SpectaClient <-->|Tauri IPC| MacroHandler
    MaskView <-->|遮罩 IPC 与定向事件| MacroHandler

    MacroHandler --> WindowEngine
    MacroHandler --> RouteEngine
    MacroHandler --> ConfigStore
    MacroHandler --> FontParser
    MacroHandler --> LLMDispatcher

    WindowEngine -.->|齐次比例几何贴合与缩放| CourseDOM
    RouteEngine ==>|页面加载完成后动态注入| CoreEngine

    CoreEngine --> StateGuard
    CoreEngine --> DOMWalker
    DOMWalker --> TaskPipeline
    TaskPipeline <-->|交互操作与完成监听| CourseDOM

    TaskPipeline -->|1. 提取加密 HTML 题目 (solve_quiz)| MacroHandler
    MacroHandler -->|调用解析| FontParser
    FontParser -->|还原明文题目| LLMDispatcher
    LLMDispatcher <==>|HTTP POST 推理请求| LLMCloud
    LLMDispatcher <==>|本地 HTTP API| OllamaLocal
    LLMDispatcher -->|2. 返回结构化答案| TaskPipeline

    TaskPipeline -.->|3. 提交任务进度 (send_status)| MacroHandler
    MacroHandler -.->|status-update 定向发送到 main| MainView

    CourseDOM <==>|加载课程与音视频资源| CXServer
```

## 前端

`src` 包含 Vue 页面、布局、组件和由 Tauri Specta 生成的命令绑定。Configuration 管理模型和课程选项；课程仪表盘订阅后端状态事件；WebView 控制栏负责课程页面的导航和缩放。

## 后端与 WebView

`src-tauri/src` 负责窗口、配置、命令和自动化逻辑。课程 WebView 访问学习通页面；后端在页面加载完成后按 URL 类型注入 `core.js`、课程信息读取脚本或登录辅助脚本。

### 启动、布局与页面链路

- `app::window::init` 创建隐藏的全屏 `app` 窗口，依次创建 `main`、`chaoxing`、
  `chaoxing-mask`、`mask` 四个子 WebView；前三个初始隐藏。开屏遮罩注册事件监听后
  调用 `start_mask` 显示窗口，开屏动画通过 `show_content` 显示主界面和课程页，
  动画完成后调用 `hide_mask`。课程页在此之前已创建并开始导航，显示内容不触发 `reload`。
- `main` 与 `mask` 覆盖整个窗口；课程页及其确认遮罩共享位置 `(0.51W, 0.46H)`、
  尺寸 `(0.48W, 0.48H)`。窗口缩放时按逻辑尺寸重算，与前端右侧 `50vw` 布局、
  `48vw` 课程容器及 `53vh` 区域（含 `5vh` 控制栏）配合，属于比例布局。
- `chaoxing` 先安装 `webview-log.js`（控制台转发）和全框架初始化脚本
  `iframe-init.js`（失焦事件处理、可见性 API 覆盖和新窗口链接转为顶层导航）。
  `core.js` 不由初始化脚本直接执行，而是在页面加载 `Finished` 回调中按 URL 分类 `eval`。
- 导航分类只接受 `chaoxing.com` 及其子域：`i` 分类为主页，`mooc1` 的 `/mycourse/`
  路径分类为课程，`mooc2-ans` 分类为课程概览，`passport2` 的 `/login` 路径分类为登录。
  其余超星页面可导航但不注入上述任务脚本；域外 URL 为 `Unknown`，导航回调拒绝它。
- 每次 `Finished` 先向 `main` 发出 `url-update` 和 `status-update(cancel)`，
  再更新自维护 URL 历史栈，最后注入相应脚本。课程概览脚本缓存课程 ID、标题与封面；
  登录辅助脚本点击 `.check-input`，并不提交账号密码。

### IPC 能力边界

能力配置按 WebView 标签区分：本地 `main` 使用 `webview.default`，两个本地遮罩使用
`webview.mask`；远程课程页使用 `webview.chaoxing`，远程匹配范围是
`https://*.chaoxing.com/**`。这些标签没有重叠，课程页不因同属一个窗口就获得
主界面或遮罩的应用命令权限。

当前 `commands-chaoxing` 只允许 `confirm`、`insert_course_meta_map`、`options`、
`platform`、`solve_quiz`、`send_status`；此外课程能力还包含 `core:default`、
`opener:default` 和 `log:default`，并非“只有答题 IPC”。导航分类范围与远程 IPC
匹配范围也不是同一规则，不能仅凭“属于超星域”推断拥有远程权限。

## 独立脚本

`src-tauri/src/scripts/core.js` 是自包含交付文件，不依赖 ES module 导入，以保留直接复制到浏览器控制台执行的能力。无后端使用方式见[无后端模式](../backend-free.md)。

脚本使用集中选择器、DOM 等待、章节→页签→任务 iframe 遍历及分层错误处理。
确认启动后才执行课程循环；视频/PDF 处理与任务容器完成类名监听并行等待。
一般 DOM 等待默认超时为 5 秒，任务点完成监听本身没有超时。任务分类发生在任务级
错误捕获之前，因此无法识别的任务（含无后端 Quiz）由外层页签处理捕获，并跳过该页签
剩余任务。全课程处理后若仍存在不可点击的阻塞章节，会等待 5 秒后重新扫描。
这里的 `finish` 表示脚本流程结束，不是后端独立核验所有任务都已完成。

桌面模式可读取配置、通过遮罩异步确认、调用 Quiz 后端并发送进度；无后端模式使用
默认配置和原生确认框，只支持已实现的非 Quiz 任务。桌面初始化脚本对各框架做失焦处理，
独立复制 `core.js` 则在确认启动后处理其执行所在的顶层窗口，不等同于逐框架初始化。

## 测验与模型

`src-tauri/src/core/quiz` 负责 HTML 提取、加密字体映射和模型请求。该模块依赖桌面端后端，不属于独立脚本模式。

- 字体还原从页面内嵌的 Base64 TTF 提取字符映射与字形，将简单正轮廓字形转换为
  Typr.js 兼容路径 JSON，计算 MD5 并取末 8 位查询内置字典；不是对整个字体文件做哈希。
  未匹配字符保留原样，复合字形和空轮廓不进入这条字形匹配路径。
- 模型请求按每批最多 5 题、最多 10 批并发执行，支持 OpenAI Chat Completions、
  OpenAI Responses 和 Google Gemini 三种协议。当前自定义供应商 UI 固定使用
  Chat Completions，不能在界面切换协议。
- 结果按批次创建顺序汇总，不额外按题号重排或校验答案数量；任一批次出错，整个求解
  调用返回错误，而不是返回已成功批次的部分答案。
- 仅 HTTP 429 自动重试，最多重试 3 次（总计最多 4 次请求）。优先采用整数秒
  `Retry-After`，否则依次等待 1、2、4 秒；网络错误、5xx 和答案 JSON 解析错误不重试。

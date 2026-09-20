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
        MacroHandler["编译期命令分发器 (commands_collector)"]
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
    MaskView <-->|窗口事件通知| MacroHandler

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
    MacroHandler -.->|status-update 事件广播| MainView

    CourseDOM <==>|加载课程与音视频资源| CXServer
```

## 前端

`src` 包含 Vue 页面、布局、组件和由 Tauri Specta 生成的命令绑定。Configuration 管理模型和课程选项；课程仪表盘订阅后端状态事件；WebView 控制栏负责课程页面的导航和缩放。

## 后端与 WebView

`src-tauri/src` 负责窗口、配置、命令和自动化逻辑。课程 WebView 访问学习通页面；后端在页面加载完成后按 URL 类型注入 `core.js`、课程信息读取脚本或登录辅助脚本。

## 独立脚本

`src-tauri/src/scripts/core.js` 是自包含交付文件，不依赖 ES module 导入，以保留直接复制到浏览器控制台执行的能力。无后端使用方式见[无后端模式](../backend-free.md)。

## 测验与模型

`src-tauri/src/core/quiz` 负责 HTML 提取、加密字体映射和模型请求。该模块依赖桌面端后端，不属于独立脚本模式。

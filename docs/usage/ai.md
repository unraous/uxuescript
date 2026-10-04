# 智能答题

智能答题仅在桌面端模式下可用。程序从课程页面提取章节测验内容；如检测到 `font-cxsecret` 加密字体，会先还原文字，再向所配置的模型供应商请求答案，并自动填入、提交章节测验。正常运行不会在提交前逐题要求人工确认。

## 配置步骤

1. 打开左下角 **Configuration** 中的 **API** 面板。
2. 选择 Provider 与 Model。可点击加号新增自定义供应商；只有自定义供应商支持在 UI 新增、重命名和删除模型，内置供应商的模型列表不可编辑。
3. 自定义供应商固定使用 OpenAI Chat Completions 协议；在 **Endpoint** 中填写完整请求 URL（例如 `https://api.example.com/v1/chat/completions`），而不是仅填写 `/v1` 基础地址。UI 不提供协议切换。
4. 输入对应供应商的 API Key（本地 Ollama 等免 Key 服务可留空）。非空密钥会去除首尾空白，并要求为 ASCII 字符且至少 12 个字符。失焦时的星号仅用于界面遮罩，不代表配置文件加密。
5. 输入完成后先移开焦点，再点击底部的 **Save** 按钮显式保存配置。选择和编辑操作先更新内存配置；正常关闭客户端也会保存配置，不应依赖强制结束进程来保存。

本地默认配置包含 BigModel、DeepSeek、Google、Moonshot、OpenAI、OpenRouter 和 Ollama。具体可用模型以供应商当前文档和账户权限为准。

## 本地 Ollama

Ollama 内置预设地址为 `http://localhost:11434/api/chat`，默认模型列表为空。当前 UI 不能向内置 Ollama 新增模型，也没有调用后端拉取 Ollama 模型命令的入口，因此不能仅靠选择该预设完成首次配置。

可在 UI 新增自定义 Provider，将 **Endpoint** 设为 Ollama 的 OpenAI 兼容接口 `http://localhost:11434/v1/chat/completions`，再新增本机已下载的模型名称，API Key 留空。请先启动 Ollama 服务，并确认所用版本提供该兼容接口。

## 加密字体还原

部分题目以 `font-cxsecret` 显示混淆文字。程序从页面样式中提取字体，按字形路径匹配映射后处理题目内容。字形哈希表的 MIT 归属见 [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md)。

## 使用边界

- API Key 以明文字符串保存于本地配置文件，不要将配置文件或密钥提交到公开仓库。
- 模型输出仅供参考，不能保证适用于所有题型。
- 无后端模式不提供智能答题。需直接复制脚本时，请使用[无后端模式](../backend-free.md)。

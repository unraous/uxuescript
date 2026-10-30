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

`tests/scripts/folio-flow.test.js` 使用完整作业样本和模拟 IPC、UEditor，验证卷面与课业背景发送、乱序答案按题号定位、十空逐项写入、阅读子题选项隔离以及翻译填写；填空答案少项、多项或空项时不写入任何答案。Rust 批处理和 prompt 用例验证嵌套材料、拆批保留全文、按题型去重及固定排列。三种模型协议的本地 HTTP mock 使用同一卷面样本核对实际请求，并验证错误空数触发批次重试。这些测试不调用真实模型，也不验证平台保存或服务器评分。

测试沿被测职责组织，场景专属数据、mock 和断言留在用例附近。公共支持只收拢真实复用的机制：Rust 的 `src-tauri/tests/unit/support.rs` 与 `support/` 提供 HTTP 模拟，固定样本在 `src-tauri/tests/assets/`。

测试清理自己创建的资源，预期样本只读。新增本地用例不应删除或替代已有外部联测。

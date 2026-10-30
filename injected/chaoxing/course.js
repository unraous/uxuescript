import { config } from "@injected/chaoxing/runtime.js";
import { emit, safeRun } from "@injected/chaoxing/course/runtime.js";
import { confirm } from "@injected/utils/backend.js";
import {
  totalChapterList,
  handleCourse,
} from "@injected/chaoxing/course/chapters.js";
import { preserveFocusState } from "@injected/chaoxing/focus.js";

/**
 * 加载配置并确认启动，依次处理课程章节，最后报告完成。
 * @returns {Promise<void>}
 */
export const main = async () => {
  await config.loadFromBackend();

  const speedInfo =
    config.lockSpeed != null ? `${config.lockSpeed}x (已锁定)` : "不锁定";
  const cdInfo =
    config.switchingCd != null ? `${config.switchingCd}秒 (±25%)` : "已关闭";
  const configSummary = `当前配置：[视频倍速: ${speedInfo} | 切换 CD: ${cdInfo} | 自动静音: ${config.muteVideo ? "已开启" : "已关闭"}]`;
  const guidance = config.hasBackend
    ? `[模型与答案]
• 答题前请在模型设置中选择可用的模型并测试连接；含图片的题目需要当前模型支持视觉输入，否则图片可能被忽略，答案可能不准确。
• 模型答案可能有误，请检查题目和答案。章节测验默认自动提交；需要提交前检查时，请在课程设置中开启“人工核验 / Review Answers”。

[等待与检查]
• 填题和开始任务前会按课程设置中的“等待时间 / Delay”暂停，并在设置值上下浮动 25%。
• 如果大量题目显示未作答，请检查页面和网络，并尝试在课程设置中调长 Delay，再重新处理未完成的题目。`
    : `[浏览器模式]
• 独立脚本不能处理章节测验，请自行完成；视频中的互动题会尝试自动处理。
• 任务操作按当前配置等待，实际等待时间上下浮动 25%。如有未完成的任务，请检查页面和网络后重试。`;

  const isConfirmed = await confirm(
    `[运行配置]
${configSummary}

${guidance}
• 流程结束后请回到课程页面检查任务点和答案；部分处理失败的章节可能被跳过。

[操作]
• 确认：开始处理；取消：退出。运行中可按 F5 刷新页面停止脚本。
• 本脚本仅供自动化测试与学习交流使用，请遵守相关法律法规及平台规定。

是否确认开始运行？`,
    { title: "课程开始", readSeconds: 5 },
  );
  if (!isConfirmed) {
    console.info("用户已取消脚本运行");
    await emit.cancelled();
    return;
  }
  preserveFocusState();

  await emit.started();
  await safeRun(() => handleCourse(totalChapterList()), "课程处理失败");
  await emit.finished();
  await confirm(
    config.hasBackend
      ? "课程处理流程已完成。请回到课程页面检查任务点状态和答案，处理失败的章节可能已跳过。\n\n如果大量题目显示未作答，请检查页面和网络，尝试在课程设置中调长等待时间 / Delay，然后重新处理未完成的题目。模型答案可能有误，请人工核对。"
      : "课程处理流程已完成。请回到课程页面检查任务点状态和答案，处理失败的章节可能已跳过。独立脚本不能处理章节测验，请自行完成。",
    { title: "课程处理已完成", readSeconds: 5 },
  );
};

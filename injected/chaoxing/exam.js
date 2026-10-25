import { showManualReviewPanel } from "@injected/chaoxing/safety.js";

/**
 * 正式考试不自动填写、不自动保存、不自动交卷。
 * 仅展示人工处理提示，避免上游考试功能绕过任务策略。
 * @returns {Promise<void>}
 */
export const main = async () => {
  await showManualReviewPanel(
    "正式考试已禁止自动化",
    "本工具不会在考试页面自动填写、保存或交卷。请在平台原生界面自行完成考试；此提示关闭后不会继续任何自动化操作。",
    [],
  );
};

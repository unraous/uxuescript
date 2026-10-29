import { config } from "@injected/chaoxing/runtime.js";
import { wait, sleep, assert } from "@injected/utils/async.js";
import { confirm } from "@injected/utils/backend.js";
import { answerPage } from "@injected/chaoxing/questions/page.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
/**
 * 提取章节测验题目与字体交给后端求解，填写后按配置核验并提交。
 * @param {Document} taskDoc 包含答题框架的测验任务点文档。
 * @returns {Promise<void>}
 */
export const handleQuiz = async (taskDoc) => {
  console.info("开始处理Quiz任务点");
  const quizDoc = await wait.iframeDoc(
    null,
    SELECTORS.quiz.frameContentId,
    taskDoc,
    "获取答题框架文档超时",
  );
  const skipped = await answerPage(quizDoc, SELECTORS.quiz);
  assert(
    skipped.length === 0,
    `存在未支持题型，停止提交：${skipped.join("、")}`,
  );

  if (config.debugTaskTypes.includes("Quiz")) {
    assert(
      await confirm(
        "[DEBUG] 答案已自动填充完成。点击[确定]继续提交，点击[取消]中断提交。",
      ),
      "调试中断：用户取消了 Quiz 提交",
    );
  }

  const submitBtn = await wait.element(
    null,
    SELECTORS.quiz.btnSubmitClass,
    quizDoc,
    "未找到题目提交按钮",
  );
  if (config.quizReview) {
    while (
      !(await confirm(
        "答案已填写完成，请核对答案；如有图片题，请确认当前模型具备视觉能力！！\n\nYes：立即提交当前答案。\nNo：暂不提交，留出 30 秒检查或修改答案，之后再次弹出本提示。\n\n如需停止脚本，请点击左上角的刷新按钮或 Home。",
      ))
    ) {
      await sleep(30000);
    }
  }
  submitBtn.click();

  const modal = await wait.element(
    null,
    SELECTORS.quiz.modalId,
    document,
    "未找到提交确认弹窗",
  );
  const popOkBtn = await wait.element(
    null,
    SELECTORS.quiz.modalOkBtnId,
    modal,
    "未找到弹窗确认按钮",
  );
  let hasOpened = false;
  await wait.until(() => {
    const isVisible = getComputedStyle(modal).display !== "none";
    if (isVisible) {
      hasOpened = true;
      popOkBtn.click();
      return null;
    }
    return hasOpened ? true : null;
  });

  console.info("已自动填充AI生成的答案并确认提交");
};

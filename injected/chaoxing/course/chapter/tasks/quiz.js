import { config } from "@injected/chaoxing/runtime.js";
import { wait, sleep, assert } from "@injected/utils/async.js";
import { confirm } from "@injected/utils/backend.js";
import { answerPage } from "@injected/chaoxing/questions/page.js";
import {
  createRetryState,
  fillRetry,
  recordSubmission,
} from "@injected/chaoxing/course/chapter/tasks/quiz/retry.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
/**
 * 提取章节测验题目与字体交给后端求解，填写后按配置核验并提交。
 * @param {Document} taskDoc 包含答题框架的测验任务点文档。
 * @param {Element} container 任务点外层容器。
 * @returns {Promise<void>}
 */
export const handleQuiz = async (taskDoc, container) => {
  console.info("开始处理Quiz任务点");
  let quizDoc = await wait.iframeDoc(
    null,
    SELECTORS.quiz.frameContentId,
    taskDoc,
    "获取答题框架文档超时",
  );
  const state = createRetryState();
  const debugging = config.debugTaskTypes.includes("Quiz");
  while (
    debugging ||
    !container.classList.contains(SELECTORS.taskPoint.finishedClass)
  ) {
    const stage = quizStage(quizDoc);
    if (stage === "model") {
      const skipped = await answerPage(quizDoc, SELECTORS.quiz);
      assert(
        skipped.length === 0,
        `存在未支持题型，停止提交：${skipped.join("、")}`,
      );
    } else {
      console.info(
        stage === "feedback"
          ? "按判分反馈修补答案"
          : "无判分反馈，尝试其他答案",
      );
      if (!state.combinations.size) recordSubmission(quizDoc, state);
      await fillRetry(quizDoc, state, stage === "feedback");
    }
    await submitQuiz(quizDoc, state);
    if (debugging) return;
    quizDoc = await waitForResult(taskDoc, quizDoc, container);
  }
  console.info("测验任务点已完成");
};

/** @param {Document} quizDoc */
const quizStage = (quizDoc) => {
  const failed = quizDoc
    .querySelector(SELECTORS.quiz.status)
    ?.textContent.includes("未达到及格线");
  if (!failed) return "model";
  return quizDoc.querySelector(
    `${SELECTORS.quiz.answerBox} ${SELECTORS.quiz.answerContent}`,
  )
    ? "feedback"
    : "trial";
};

const reviewQuiz = async () => {
  if (config.debugTaskTypes.includes("Quiz")) {
    assert(
      await confirm(
        "[DEBUG] 答案已自动填充完成。点击[确定]继续提交，点击[取消]中断提交。",
      ),
      "调试中断：用户取消了 Quiz 提交",
    );
  }

  if (config.quizReview) {
    while (
      !(await confirm(
        "答案已填写完成，请核对答案；如有图片题，请确认当前模型具备视觉能力！！\n\nYes：立即提交当前答案。\nNo：暂不提交，留出 30 秒检查或修改答案，之后再次弹出本提示。\n\n如需停止脚本，请点击左上角的刷新按钮或 Home。",
      ))
    ) {
      await sleep(30000);
    }
  }
};

/** @param {Document} quizDoc @param {import("@injected/chaoxing/course/chapter/tasks/quiz/retry.js").RetryState} state */
const submitQuiz = async (quizDoc, state) => {
  await reviewQuiz();
  const submitBtn = await wait.element(
    null,
    SELECTORS.quiz.btnSubmitClass,
    quizDoc,
    "未找到题目提交按钮",
  );
  recordSubmission(quizDoc, state);
  submitBtn.click();

  await confirmSubmission();
  console.info("已确认提交测验答案");
};

const confirmSubmission = async () => {
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
  const opened = await wait.until(
    () => getComputedStyle(modal).display !== "none",
  );
  assert(opened, "等待提交确认弹窗超时");
  popOkBtn.click();
  const closed = await wait.until(() => {
    if (getComputedStyle(modal).display === "none") return true;
    const content = modal.querySelector(SELECTORS.quiz.modalContentId);
    return content?.textContent.includes("未达到及格线") ? true : null;
  });
  assert(closed, "等待提交确认弹窗关闭超时");
};

/**
 * @param {Document} taskDoc
 * @param {Document} oldDoc
 * @param {Element} container
 * @returns {Promise<Document>}
 */
const waitForResult = async (taskDoc, oldDoc, container) => {
  let dismissedFailure = false;
  const next = await wait.until(() => {
    if (container.classList.contains(SELECTORS.taskPoint.finishedClass))
      return oldDoc;
    if (!dismissedFailure && dismissFailurePrompt()) dismissedFailure = true;
    const frame = /** @type {HTMLIFrameElement|null} */ (
      taskDoc.querySelector(SELECTORS.quiz.frameContentId)
    );
    const doc = frame?.contentDocument;
    if (
      doc &&
      doc !== oldDoc &&
      doc.body?.children.length &&
      doc
        .querySelector(SELECTORS.quiz.status)
        ?.textContent.includes("未达到及格线")
    )
      return doc;
    return null;
  }, 30000);
  assert(next, "等待测验结果或任务点完成超时");
  return next;
};

const dismissFailurePrompt = () => {
  const modal = document.querySelector(SELECTORS.quiz.modalId);
  const content = document.querySelector(SELECTORS.quiz.modalContentId);
  if (
    !modal ||
    getComputedStyle(modal).display === "none" ||
    !content?.textContent.includes("未达到及格线")
  )
    return false;
  const button = /** @type {HTMLElement|null} */ (
    modal.querySelector(SELECTORS.quiz.modalOkBtnId)
  );
  assert(button, "未找到未及格提示确认按钮");
  button.click();
  return true;
};

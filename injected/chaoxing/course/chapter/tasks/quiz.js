import { cooldown } from "@injected/chaoxing/runtime.js";
import { wait, assert } from "@injected/utils/async.js";
import { invoke, confirm } from "@injected/utils/backend.js";
import { fillAnswer } from "@injected/chaoxing/questions/fill.js";
import { extractPayload } from "@injected/chaoxing/questions/extract.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
import {
  ManualReviewRequired,
  assertSubmitAllowed,
  controller,
  resolveQuizPolicy,
  showManualReviewPanel,
} from "@injected/chaoxing/safety.js";

/**
 * @param {Element[]} quizList
 * @param {import("../../../../../src/services/cmds").AnswerItem[]} answersList
 */
const applyAnswers = async (quizList, answersList) => {
  assert(
    quizList.length === answersList.length,
    `AI 返回答案数 (${answersList.length}) 与题目数 (${quizList.length}) 不匹配，拒绝提交`,
  );
  for (const [index, quizDiv] of quizList.entries()) {
    await controller.checkpoint();
    await cooldown();
    await fillAnswer(quizDiv, answersList[index].content, SELECTORS.quiz);
  }
};

/**
 * @param {Element[]} quizList
 * @param {import("../../../../../src/services/cmds").AnswerItem[]} answersList
 */
const reviewItems = (quizList, answersList) =>
  answersList.map((answer, index) => ({
    question:
      quizList[index]?.textContent?.trim().slice(0, 300) ||
      `第 ${index + 1} 题`,
    answer: answer.content,
    explanation: answer.explanation,
  }));

/**
 * 章节测验：先分类授权，再求解/填写，最后独立审核提交。
 * @param {Document} taskDoc
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

  const policy = await resolveQuizPolicy(quizDoc, "章节测验", confirm);
  if (!policy.allowFill) {
    await showManualReviewPanel(
      "参考答案（未自动填写/提交）",
      `策略：${policy.kind}（${policy.reason}）。请人工核对题目并在平台原生界面完成。`,
      [],
    );
    throw new ManualReviewRequired("策略不允许自动填写章节测验");
  }

  const quizList = await wait.elements(null, SELECTORS.quiz.question, quizDoc);
  let answersList;
  try {
    answersList = await invoke("solve_questions", {
      payload: extractPayload(quizDoc, quizList, SELECTORS.quiz),
    });
  } catch (error) {
    await showManualReviewPanel(
      "AI 求解失败",
      `未生成可用答案，未填写、未提交。${error instanceof Error ? error.message : String(error)}`,
      [],
    );
    throw new ManualReviewRequired("AI 求解失败，停止当前测验");
  }
  assert(Array.isArray(answersList), "AI 未返回答案数组");
  if (answersList.some((answer) => !String(answer.content ?? "").trim())) {
    await showManualReviewPanel(
      "答案不完整，未自动填写或提交",
      "部分题目生成失败；已保留成功结果供人工参考。请检查后在平台原生界面处理。",
      reviewItems(quizList, answersList),
    );
    throw new ManualReviewRequired("答案不完整，停止当前测验");
  }
  await applyAnswers(quizList, answersList);

  if (!policy.allowSubmit) {
    await showManualReviewPanel(
      "答案已填写，未自动提交",
      `策略：${policy.kind}（${policy.reason}）。请检查后在平台原生界面手动提交。`,
      reviewItems(quizList, answersList),
    );
    throw new ManualReviewRequired("策略未授权自动提交章节测验");
  }

  // 提交授权之后仍需独立最终审核；不因 quizReview=false 而跳过。
  {
    const accepted = await confirm(
      `答案已填写，请人工核验。\n\nYes：提交当前测验。\nNo：不提交并停止自动化。\n\n如非明确授权的非计分练习，请选择 No。`,
    );
    if (!accepted) {
      await showManualReviewPanel(
        "已取消提交",
        "最终审核未通过，任务已停止；平台原生界面仍可手动处理。",
        reviewItems(quizList, answersList),
      );
      throw new ManualReviewRequired("用户拒绝自动提交章节测验");
    }
  }

  await controller.checkpoint();
  assertSubmitAllowed(policy);
  const submitBtn = await wait.element(
    null,
    SELECTORS.quiz.btnSubmitClass,
    quizDoc,
    "未找到题目提交按钮",
  );
  await controller.checkpoint();
  assertSubmitAllowed(policy);
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
  await controller.checkpoint();
  assertSubmitAllowed(policy);
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

  console.info("已按授权策略填写并提交章节测验");
};

import { cooldown } from "@injected/chaoxing/runtime.js";
import { wait, assert } from "@injected/utils/async.js";
import { confirm } from "@injected/utils/backend.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
import {
  ManualReviewRequired,
  assertSubmitAllowed,
  controller,
  resolveQuizPolicy,
  showManualReviewPanel,
} from "@injected/chaoxing/safety.js";
import { waitForTimeline } from "./timeline.js";
/**
 * @typedef {Object} QuizData
 * @property {{name: string}[]} [options]
 * @property {string} [questionType]
 * @property {string | number} [resourceId]
 * @property {string} [memberinfo]
 * @property {string} [description]
 * @property {string} [answerContent]
 */

/**
 * @param {string} validationUrl
 * @param {QuizData} quizData
 * @param {string} answerContent
 * @param {string} host
 */
const buildValidationUrl = (validationUrl, quizData, answerContent, host) => {
  const url = new URL(validationUrl, host);
  url.searchParams.set("_dc", String(Date.now()));
  url.searchParams.set("eventid", String(quizData.resourceId));
  url.searchParams.set("memberinfo", String(quizData.memberinfo));
  url.searchParams.set("answerContent", answerContent);
  return url.href;
};

/**
 * @param {QuizData} quizData
 */
const getAnswerCandidates = (quizData) => {
  const optionNames = (quizData.options ?? [])
    .map(({ name }) =>
      String(name ?? "")
        .trim()
        .toUpperCase(),
    )
    .filter(Boolean);

  /** @type {string[]} */
  const candidates = [];

  const isMulti = String(quizData.questionType ?? "").includes("多选");
  for (const optionName of optionNames) {
    const previous = candidates.slice();
    candidates.push(optionName);
    if (isMulti) {
      for (const candidate of previous)
        candidates.push(`${candidate},${optionName}`);
    }
  }
  return candidates;
};

/**
 * @param {string} url
 */
const requestValidation = async (url) => {
  await cooldown();
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok)
    throw new Error(`互动题验证请求失败：HTTP ${response.status}`);
  return /** @type {{isRight: boolean}} */ (await response.json());
};

/**
 * 随机排序候选答案后逐个请求页面验证接口，首次正确即停止。
 * @param {string} validationUrl 页面提供的验证地址。
 * @param {QuizData} quizData Ext 中的互动题数据，包含 options、resourceId 和 memberinfo。
 * @param {string} host 用于解析相对验证地址的页面来源。
 * @returns {Promise<string>} 页面验证通过的答案标识。
 */
export const resolveInteractiveQuizAnswer = async (
  validationUrl,
  quizData,
  host,
) => {
  const candidates = getAnswerCandidates(quizData);
  for (let index = candidates.length - 1; index > 0; index--) {
    const target = Math.floor(Math.random() * (index + 1));
    [candidates[index], candidates[target]] = [
      candidates[target],
      candidates[index],
    ];
  }
  console.info("开始验证互动题候选答案", {
    resourceId: quizData.resourceId,
    description: quizData.description,
    candidateCount: candidates.length,
  });

  const results = [];
  try {
    for (const answerContent of candidates) {
      const result = await requestValidation(
        buildValidationUrl(validationUrl, quizData, answerContent, host),
      );
      results.push({ answerContent, isRight: result.isRight });
      console.info("互动题候选答案验证结果", {
        resourceId: quizData.resourceId,
        isRight: result.isRight,
      });
      if (result.isRight) return answerContent;
    }
  } catch (error) {
    console.error(
      "互动题候选答案验证请求失败",
      {
        resourceId: quizData.resourceId,
        description: quizData.description,
        results,
      },
      error,
    );
    throw error;
  }
  throw new Error(
    `互动题验证未返回正确答案（候选数：${candidates.length}）`,
  );
};

/**
 * @param {HTMLElement} timeline
 * @param {QuizData[]} datas
 * @param {string} validationUrl2
 */
const resolveInteractiveQuizData = async (timeline, datas, validationUrl2) => {
  const host = timeline.ownerDocument.location.origin;

  /** @param {unknown} error */
  const showAnswerFailure = async (error) => {
    console.error("互动题答案未能解析", {
      timelineId: timeline.id,
      resourceCount: datas.length,
      error: error instanceof Error ? error.message : String(error),
    });
    await confirm("互动题答案获取失败，未填写、未提交；请人工处理。");
  };

  for (const quizData of datas) {
    const existingAnswer = String(quizData.answerContent ?? "").trim();
    if (existingAnswer) {
      console.info("互动题使用 Ext 中已有答案", {
        resourceId: quizData.resourceId,
        description: quizData.description,
        answerContent: existingAnswer,
      });
      continue;
    }

    try {
      quizData.answerContent = await resolveInteractiveQuizAnswer(
        validationUrl2,
        quizData,
        host,
      );
    } catch (error) {
      await showAnswerFailure(error);
      throw error;
    }
  }

  const unanswered = datas.filter(
    ({ answerContent }) => !String(answerContent ?? "").trim(),
  );
  if (unanswered.length) {
    const error = new Error(`互动题答案缺失（${unanswered.length} 道）`);
    await showAnswerFailure(error);
    throw error;
  }

  return datas;
};

/**
 * @param {Element} optionNode
 */
const clickInteractiveQuizOption = (optionNode) =>
  optionNode.querySelector("label")?.click();

/**
 * @param {Element} quizRoot
 * @param {QuizData} quizData
 */
const fillInteractiveQuiz = async (quizRoot, quizData) => {
  const optionNodes = await wait.elements(
    null,
    SELECTORS.video.quizOptionClass,
    quizRoot,
  );
  const answerNames = new Set(
    String(quizData.answerContent ?? "")
      .toUpperCase()
      .match(/[A-Z0-9]/g) ?? [],
  );
  for (const input of quizRoot.querySelectorAll("input")) {
    input.checked = false;
    input.removeAttribute("checked");
  }
  for (const [index, option] of (quizData.options ?? []).entries()) {
    const optionNode = optionNodes[index];
    if (optionNode && answerNames.has(String(option.name).toUpperCase())) {
      clickInteractiveQuizOption(optionNode);
    }
  }
};

/**
 * @param {Element} quizRoot
 * @param {QuizData[]} quizDatas
 */
const matchInteractiveQuizItems = async (quizRoot, quizDatas) => {
  const quizItems = await wait.elements(
    null,
    SELECTORS.video.quizItemClass,
    quizRoot,
  );

  const items = [];
  for (const quizItem of quizItems) {
    const title = (
      await wait.element(null, SELECTORS.video.quizTitleClass, quizItem)
    ).textContent
      ?.trim()
      .replace(/\s+/g, " ");
    const matches = quizDatas.filter(
      ({ description }) => description?.trim().replace(/\s+/g, " ") === title,
    );
    assert(matches.length === 1, `互动题题干未唯一匹配：${title}`);
    items.push({ element: quizItem, data: matches[0] });
  }
  return items;
};

/**
 * @param {{element: Element, data: QuizData}[]} items
 * @param {QuizData[]} quizDatas
 */
const fillInteractiveQuizItems = async (items, quizDatas) => {
  for (const { element, data } of items) {
    await controller.checkpoint();
    await cooldown();
    console.info(
      `开始处理第 ${quizDatas.indexOf(data) + 1}/${quizDatas.length} 道互动题`,
      { resourceId: data.resourceId, title: data.description },
    );
    await fillInteractiveQuiz(element, data);
  }
};

/** @param {{element: Element, data: QuizData}[]} items */
const interactiveReviewItems = (items) =>
  items.map(({ data }, index) => ({
    question: data.description || `第 ${index + 1} 道互动题`,
    answer: data.answerContent || "未生成",
    explanation: "",
  }));

/**
 * @param {Element} quizRoot
 * @param {{element: Element, data: QuizData}[]} items
 * @param {{allowSubmit: boolean}} policy
 */
const submitInteractiveQuiz = async (quizRoot, items, policy) => {
  await controller.checkpoint();
  assertSubmitAllowed(policy);

  // 提交授权之后仍需独立最终审核。
  {
    const accepted = await confirm(
      `互动题答案已填写，请人工核验。\n\nYes：提交当前互动题。\nNo：不提交并停止自动化。\n\n如非明确授权的非计分练习，请选择 No。`,
    );
    if (!accepted) {
      await showManualReviewPanel(
        "已取消提交互动题",
        "最终审核未通过，任务已停止；平台原生界面仍可手动处理。",
        interactiveReviewItems(items),
      );
      throw new ManualReviewRequired("用户拒绝自动提交互动题");
    }
  }

  await controller.checkpoint();
  assertSubmitAllowed(policy);
  const submitButton = await wait.element(
    null,
    SELECTORS.video.quizSubmitId,
    quizRoot,
  );
  await controller.checkpoint();
  assertSubmitAllowed(policy);
  submitButton.click();

  const continueButton = await wait.element(
    null,
    SELECTORS.video.quizContinueId,
    quizRoot,
    false,
  );

  if (continueButton) {
    await wait.until(() => {
      if (getComputedStyle(continueButton).display === "none") return null;
      continueButton.click();
      return true;
    });
  }
};

/**
 * 解析时间轴题目答案，监听题目出现，逐组填写并提交，直到末题或视频结束。
 * @param {HTMLElement} timeline 时间轴节点。
 * @param {HTMLVideoElement} videoEl 视频控件。
 * @param {QuizData[]} quizDatas 时间轴提取的互动题。
 * @param {string} validationUrl2 页面提供的验证地址。
 * @returns {Promise<void>}
 */
export const handleInteractiveQuiz = async (
  timeline,
  videoEl,
  quizDatas,
  validationUrl2,
) => {
  console.info(
    quizDatas.length
      ? `视频包含 ${quizDatas.length} 道互动题，开始处理`
      : "视频无互动题",
  );
  if (!quizDatas.length || videoEl.ended) return;

  const policy = await resolveQuizPolicy(
    timeline.ownerDocument,
    "视频互动题",
    confirm,
  );
  if (!policy.allowFill) {
    await showManualReviewPanel(
      "互动题需要人工处理",
      `策略：${policy.kind}（${policy.reason}）。未读取/验证/填写/提交任何互动题答案。`,
      [],
    );
    throw new ManualReviewRequired("策略不允许自动填写视频互动题");
  }

  await controller.checkpoint();
  await resolveInteractiveQuizData(timeline, quizDatas, validationUrl2);
  const lastQuizData = quizDatas[quizDatas.length - 1];
  let lastQuizSubmitted = false;
  while (!lastQuizSubmitted && !videoEl.ended) {
    await controller.checkpoint();
    const quizRoot = await waitForTimeline(timeline, videoEl, () =>
      timeline.querySelector(SELECTORS.video.quizClass),
    );
    if (!quizRoot) break;
    const items = await matchInteractiveQuizItems(quizRoot, quizDatas);
    await fillInteractiveQuizItems(items, quizDatas);
    if (!policy.allowSubmit) {
      await showManualReviewPanel(
        "互动题已填写，未自动提交",
        `策略：${policy.kind}（${policy.reason}）。请检查后在平台原生界面手动提交。`,
        interactiveReviewItems(items),
      );
      throw new ManualReviewRequired("策略未授权自动提交视频互动题");
    }
    await submitInteractiveQuiz(quizRoot, items, policy);
    lastQuizSubmitted = items.some(
      ({ data }) => data.resourceId === lastQuizData.resourceId,
    );
  }
  console.info(
    lastQuizSubmitted
      ? "视频互动题处理完毕，最后一道题已执行提交流程"
      : "视频已结束，停止处理互动题",
  );
};

import { config, cooldown } from "@injected/chaoxing/runtime.js";
import { assert, wait } from "@injected/utils/async.js";
import { confirm } from "@injected/utils/backend.js";
import { parseFolio, questions } from "@injected/chaoxing/questions/folio.js";
import { solveFolio, applyAnswers } from "@injected/chaoxing/questions/page.js";
import { readContext } from "@injected/chaoxing/questions/context.js";
import { classifyQuestion } from "@injected/chaoxing/questions/extract.js";
import { QuestionType } from "@injected/chaoxing/questions/types.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
const ANSWER_CARD_ENTRIES = ".topicNumber_list li[data-asq]";
const page =
  /** @type {Window & typeof globalThis & {submitForm(save: boolean, submit: boolean, callback: () => void): void, getTheQuestionByStart(start: number, mode: string): void}} */ (
    window
  );

/**
 * @typedef {Object} ExamRun
 * @property {"collect" | "answer"} phase
 * @property {number} index 当前待处理题目在答题卡中的位置，从 0 开始。
 * @property {{switchingCd: number|null}} config 本次运行使用的配置快照。
 * @property {{id: string, start: number}[]} entries
 * @property {import("@injected/chaoxing/questions/folio.js").Folio[]} pages
 * @property {import("../../../src/services/cmds").AnswerItem[]} answers
 */

/**
 * @param {string} id
 */
const value = (id) =>
  /** @type {HTMLInputElement|null} */ (document.getElementById(id))?.value ??
  "";
const save = async () => {
  let saved = false;
  page.submitForm(true, false, () => {
    saved = true;
  });
  assert(await wait.until(() => saved, 15000), "暂存超时");
};

/** 读取答题卡中的页面内部 ID 和跳题位置，仅用于前端导航。 */
const readEntries = () =>
  Array.from(document.querySelectorAll(ANSWER_CARD_ENTRIES), (entry) => {
    const match = entry
      .getAttribute("onclick")
      ?.match(/getTheQuestionByStart\(\s*(\d+)\s*,\s*['"]0['"]\s*\)/);
    assert(match, "答题卡包含不支持的跳题方式或分卷");
    return {
      id: entry.getAttribute("data-asq") ?? "",
      start: Number(match[1]),
    };
  });

/** 检查当前考试是否允许两遍遍历。 */
const assertExamSupported = () => {
  assert(value("teacherBrowseMode") !== "true", "教师预览模式不支持自动答题");
  assert(
    ![
      "forbidAnsweredAgain",
      "forbidGroupAnswerBack",
      "singleQuesLimitTime",
      "groupLimitTimeType",
      "limitTimeType",
    ].some((id) => Number(value(id)) > 0) && value("allowAnswerBack") !== "0",
    "当前考试限制回看或作答顺序，不支持两遍遍历",
  );
};

/**
 * 初始化：恢复存储的进度和配置；首次运行时创建并保存。
 * @param {string} key 当前考试的存储键。
 * @returns {Promise<ExamRun|null>} 用户取消时返回 null。
 */
const initialize = async (key) => {
  assertExamSupported();
  let run = /** @type {ExamRun|null} */ (
    JSON.parse(window.sessionStorage.getItem(key) ?? "null")
  );
  if (!run) {
    run = await startRun();
    if (!run) return null;
    persistRun(key, run);
  }
  config.switchingCd = run.config.switchingCd;
  return run;
};

/**
 * 确认新运行并建立采集进度。
 * @returns {Promise<ExamRun|null>} 用户取消时返回 null。
 */
const startRun = async () => {
  if (
    !(await confirm(
      "是否开始考试答题？先遍历采集整卷，再回到第一题填写并保存；不自动交卷。\n\n含图片的题目需要当前模型支持视觉输入；否则图片可能被忽略，答案可能不准确。",
    ))
  )
    return null;
  await config.loadFromBackend();
  const entries = readEntries();
  return {
    phase: "collect",
    index: 0,
    config: { switchingCd: config.switchingCd },
    entries,
    pages: [],
    answers: [],
  };
};

/**
 * 把两遍处理进度写入当前窗口，供翻页后继续使用。
 * @param {string} key 当前考试的存储键。
 * @param {ExamRun} run 两遍处理进度。
 * @returns {void}
 */
const persistRun = (key, run) =>
  window.sessionStorage.setItem(key, JSON.stringify(run));

/**
 * 调用页面跳题入口，等待导航开始。
 * @param {{id: string, start: number}} entry 目标答题卡条目。
 * @returns {Promise<void>}
 */
const navigateTo = async (entry) => {
  await cooldown();
  const previous = window.location.href;
  page.getTheQuestionByStart(entry.start, "0");
  assert(
    await wait.until(() => window.location.href !== previous, 15000),
    "保存并翻页超时",
  );
};

/**
 * 将支持的题目交给后端求解。
 * @param {ExamRun} run 已采集完整的考试进度。
 * @returns {Promise<void>}
 */
const solveExam = async (run) => {
  run.answers = await solveFolio({
    entries: run.pages.flatMap((folio) => folio.entries),
    font: run.pages.find((folio) => folio.font)?.font ?? null,
    context: run.pages[0].context,
  });
};

/**
 * 用显示题号匹配答案并填写当前题目；未支持的题型留给人工处理。
 * @param {Element} node 当前题目容器。
 * @param {ExamRun} run 已求解的考试进度。
 * @returns {Promise<void>}
 */
const answerQuestion = async (node, run) => {
  const { folio, anchors } = parseFolio(node.ownerDocument, SELECTORS.workExam);
  const ids = new Set(questions(folio.entries).map((question) => question.id));
  await applyAnswers(
    folio,
    anchors,
    run.answers.filter((answer) => ids.has(answer.index)),
  );
};

/**
 * 暂存末题，清除处理进度并提示人工检查、交卷。
 * @param {ExamRun} run 本次考试进度。
 * @param {string} key 当前考试的存储键。
 * @returns {Promise<void>}
 */
const finishExam = async (run, key) => {
  await save();
  window.sessionStorage.removeItem(key);
  const skipped = run.pages
    .flatMap((folio) => questions(folio.entries))
    .flatMap((item) =>
      classifyQuestion(item.kind) !== QuestionType.Other
        ? []
        : [`${item.id}（${item.kind}）`],
    );
  await confirm(
    `答案已填写并暂存，请核对答案后自行交卷；如有图片题，请确认当前模型具备视觉能力！！${skipped.length ? `\n需人工处理的题号：${skipped.join("、")}` : ""}`,
  );
};

/**
 * 提取当前题目到本次进度。
 * @param {Element} node 当前题目容器。
 * @param {ExamRun} run 考试进度。
 */
const collectQuestion = async (node, run) => {
  const { folio } = parseFolio(node.ownerDocument, SELECTORS.workExam);
  folio.context =
    run.pages[0]?.context ?? (await readContext(node.ownerDocument));
  run.pages[run.index] = folio;
};

/**
 * 执行：按存储的策略采集或填写当前题目。
 * @param {Element} node 当前题目容器。
 * @param {ExamRun} run 考试进度。
 * @returns {Promise<void>}
 */
const execute = async (node, run) => {
  if (run.phase === "collect") {
    await collectQuestion(node, run);
  } else {
    await answerQuestion(node, run);
  }
};

/**
 * 结束：推进题号，采集末题后求解并切换填写，填写末题后完成。
 * @param {ExamRun} run 考试进度。
 * @param {string} key 当前考试的存储键。
 * @returns {Promise<void>}
 */
const finish = async (run, key) => {
  if (run.index + 1 < run.entries.length) {
    run.index++;
  } else if (run.phase === "collect") {
    persistRun(key, run);
    await solveExam(run);
    run.phase = "answer";
    run.index = 0;
  } else {
    await finishExam(run, key);
    return;
  }
  persistRun(key, run);
  await navigateTo(run.entries[run.index]);
};

/**
 * 通过页面翻题采集整卷，再返回首题填写和暂存，不自动交卷。
 * 两遍进度保存在当前窗口 sessionStorage 中，导航后由重新注入的脚本继续。
 * @returns {Promise<void>}
 */
export const answerPaged = async () => {
  let key = "";
  /** @type {ExamRun|null} */
  let run = null;
  try {
    const node = await wait.element(
      null,
      SELECTORS.workExam.question,
      document,
      "等待考试题目超时",
    );
    const current = node.getAttribute("data");
    key = `uxs:exam:folio:${value("testPaperId")}:${value("testUserRelationId")}`;
    run = await initialize(key);
    if (!run) return;
    assert(
      run.entries[run.index].id === current,
      "当前题目与存储进度不一致，不支持手动跳题，请从第一题开始",
    );
    console.info("考试进度：", run.phase, run.index + 1);
    await execute(node, run);
    await finish(run, key);
  } catch (error) {
    const position = run
      ? `${run.phase === "collect" ? "采集" : "填写"}第 ${run.index + 1} 题`
      : "初始化";
    if (key) window.sessionStorage.removeItem(key);
    console.error(`考试处理失败：${position}`, error);
    await confirm(
      `考试处理失败（${position}）：${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

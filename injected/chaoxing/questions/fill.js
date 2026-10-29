import { wait, assert } from "@injected/utils/async.js";
import { fillEditor } from "./editor.js";
import { classifyQuestion } from "./extract.js";
import { QuestionType } from "./types.js";
/**
 * @param {Element} node
 * @param {string} selector
 */
const cleanup = (node, selector) => {
  const selectedList = /** @type {NodeListOf<HTMLSpanElement>} */ (
    node.querySelectorAll(selector)
  );
  for (const el of selectedList) el.click();
};

/**
 * @param {Element} quizDiv
 * @param {string} content
 * @param {string} selector
 */
const fillSingle = (quizDiv, content, selector) => {
  const rawContent = String(content).trim();
  assert(rawContent, "单选题 AI 返回答案为空，拒绝提交");

  const opt = /** @type {HTMLSpanElement|null} */ (
    quizDiv.querySelector(`${selector}[data="${rawContent}"]`)
  );
  assert(opt, `单选题未找到对应选项 [${rawContent}]，拒绝提交`);
  opt.click();
};

/**
 * @param {Element} quizDiv
 * @param {string} content
 * @param {string} selector
 */
const fillMulti = (quizDiv, content, selector) => {
  const ansArr = String(content).match(/[A-Z0-9]/gi);
  assert(
    ansArr?.length,
    `多选题 AI 答案无法解析为有效选项 [${content}]，拒绝提交`,
  );

  for (const ch of ansArr) {
    const opt = /** @type {HTMLSpanElement|null} */ (
      quizDiv.querySelector(`${selector}[data="${ch}"]`)
    );
    assert(opt, `多选题未找到选项 [${ch}]，拒绝提交`);
    opt.click();
  }
};

/**
 * @param {Element} quizDiv
 * @param {string} content
 * @param {string} selector
 */
const fillJudge = (quizDiv, content, selector) => {
  const trimmed = String(content).trim();
  assert(trimmed, "判断题 AI 返回答案为空，拒绝提交");
  // 提取时按页面顺序给判断选项编号 A/B，填写时使用同一顺序。
  const labels = /** @type {NodeListOf<HTMLSpanElement>} */ (
    quizDiv.querySelectorAll(selector)
  );
  const opt = labels[trimmed.toUpperCase() === "A" ? 0 : 1];

  assert(opt, `判断题未找到对应选项 [${trimmed}]，拒绝提交`);
  opt.click();
};

/**
 * @param {HTMLInputElement | HTMLTextAreaElement} input
 * @param {string} text
 */
const setTextContent = async (input, text) => {
  if (input.tagName === "TEXTAREA") {
    await fillEditor(/** @type {HTMLTextAreaElement} */ (input), text);
  } else {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
};

/**
 * @param {Element} quizDiv
 * @param {string} content
 * @param {string} selector
 */
const fillCompletion = async (quizDiv, content, selector) => {
  const ansArr = String(content)
    .split(";")
    .map((s) => s.trim());
  const inputs = /** @type {(HTMLInputElement | HTMLTextAreaElement)[]} */ (
    await wait.elements(null, selector, quizDiv)
  );
  assert(
    ansArr.length === inputs.length && ansArr.every(Boolean),
    `填空题需要 ${inputs.length} 个非空答案，收到 ${ansArr.length} 项，拒绝填写`,
  );
  for (const [index, input] of inputs.entries()) {
    await setTextContent(input, ansArr[index]);
  }
};

/**
 * @param {Element} quizDiv
 * @param {string} content
 * @param {string} selector
 */
const fillShort = async (quizDiv, content, selector) => {
  const val = String(content).trim();
  assert(val, "简答题 AI 返回答案为空，拒绝提交");
  const input = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (
    await wait.element(null, selector, quizDiv)
  );
  await setTextContent(input, val);
};

/**
 * 清空旧选项后按题型填写答案。
 * @param {Element} node 当前题目容器。
 * @param {string} content 模型返回的答案。
 * @param {{kind: string, choice: {single: string, multiple: string}, clearSelectedClass: string, textInputs: string}} selectors 页面选择器。
 * @returns {Promise<void>}
 */
export const fillAnswer = async (node, content, selectors) => {
  const kind = classifyQuestion(node.querySelector(selectors.kind).textContent);
  cleanup(node, selectors.clearSelectedClass);
  switch (kind) {
    case QuestionType.SingleChoice:
      return fillSingle(node, content, selectors.choice.single);
    case QuestionType.MultipleChoice:
      return fillMulti(node, content, selectors.choice.multiple);
    case QuestionType.Judgment:
      return fillJudge(node, content, selectors.choice.single);
    case QuestionType.Completion:
      return fillCompletion(node, content, selectors.textInputs);
    case QuestionType.ShortAnswer:
    case QuestionType.Translation:
      return fillShort(node, content, selectors.textInputs);
    default:
      throw new Error(`未支持的题目类型: ${kind}`);
  }
};

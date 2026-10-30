import { assert } from "@injected/utils/async.js";
import { extractMatchingOptions } from "./matching.js";
import { QuestionType } from "./types.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";

/**
 * Rust 是跨端模型的唯一来源；注入脚本只引用自动生成的输入类型。
 * @typedef {import("../../../src/services/cmds").Question_Deserialize} Question
 */

/**
 * 单道题提取所需的页面定位规则。
 * @typedef {Object} ExtractionSelectors
 * @property {string} number 显示题号。
 * @property {string} kind 题型名称。
 * @property {string} [kindName] 未单独标注题型的共用选项子题继承单选语义。
 * @property {string} title 题干容器。
 * @property {string} titleMeta 题干中需要移除的题型及分值。
 * @property {string} optionLabel 选项标识。
 * @property {{options: string, text: string}} choice 选项容器及文字。
 */

/**
 * @param {Node} node
 */
const text = (node) => node.textContent.replace(/\s+/g, " ").trim();

/**
 * 超星公式图片会把原始 LaTeX 作为 URI 编码字符串保存在 data 属性中。
 * @param {Element} image
 */
const latex = (image) => {
  if (!image.classList.contains("ans-latex-moudle")) return null;
  const encoded = image.getAttribute("data");
  assert(encoded, "公式图片缺少 LaTeX 数据");
  const decoded = decodeURIComponent(encoded);
  const value = decoded.startsWith('"') ? JSON.parse(decoded) : decoded;
  assert(
    typeof value === "string" && value.trim(),
    "公式图片的 LaTeX 数据无效",
  );
  return value.trim();
};

/**
 * @param {Element} root
 * @param {{marker: string, url: string}[]} images
 */
export const extractContent = (root, images) => {
  const clone = /** @type {Element} */ (root.cloneNode(true));
  for (const image of clone.querySelectorAll("img")) {
    const source = latex(image);
    if (source) {
      image.replaceWith(` [公式: ${source}] `);
      continue;
    }
    const src = image.getAttribute("src");
    assert(src, "题目图片缺少地址");
    const marker = `图片${images.length + 1}`;
    images.push({
      marker,
      url: new URL(src, image.ownerDocument.baseURI).href,
    });
    image.replaceWith(` [${marker}] `);
  }
  return text(clone);
};

/**
 * 从页面题型文字识别处理类别。
 * @param {string} titleText
 */
export const classifyQuestion = (titleText) => {
  if (titleText.includes("多选")) return QuestionType.MultipleChoice;
  if (titleText.includes("判断")) return QuestionType.Judgment;
  if (titleText.includes("单选")) return QuestionType.SingleChoice;
  if (titleText.includes("填空")) return QuestionType.Completion;
  if (titleText.includes("分录")) return QuestionType.Completion;
  if (titleText.includes("简答")) return QuestionType.ShortAnswer;
  if (titleText.includes("论述")) return QuestionType.ShortAnswer;
  if (titleText.includes("计算")) return QuestionType.ShortAnswer;
  if (titleText.includes("翻译")) return QuestionType.Translation;
  if (titleText.includes("连线")) return QuestionType.Matching;
  return QuestionType.Other;
};

/**
 * @param {Element} node
 * @param {ExtractionSelectors["choice"]} choice
 * @param {(option: Element, index: number) => string} labelFor
 * @param {{marker: string, url: string}[]} images
 */
const readChoices = (node, choice, labelFor, images) =>
  Array.from(node.querySelectorAll(choice.options), (option, index) => {
    const label = labelFor(option, index);
    const choiceText = /** @type {Element} */ (
      option.querySelector(choice.text)
    );
    return `${label} ${extractContent(choiceText, images)}`;
  });

/**
 * @param {Element} node
 * @param {ExtractionSelectors} selectors
 * @param {{marker: string, url: string}[]} images
 */
const extractChoiceOptions = (node, selectors, images) =>
  readChoices(
    node,
    selectors.choice,
    (option) =>
      option.querySelector(selectors.optionLabel).getAttribute("data"),
    images,
  );

/**
 * @param {Element} node
 * @param {ExtractionSelectors} selectors
 * @param {{marker: string, url: string}[]} images
 */
const extractJudgeOptions = (node, selectors, images) =>
  readChoices(
    node,
    selectors.choice,
    (_option, index) => String.fromCharCode(65 + index),
    images,
  );

/** @type {Partial<Record<ReturnType<typeof classifyQuestion>, (node: Element, selectors: ExtractionSelectors, images: {marker: string, url: string}[]) => string[]>>} */
const optionExtractors = {
  [QuestionType.SingleChoice]: extractChoiceOptions,
  [QuestionType.MultipleChoice]: extractChoiceOptions,
  [QuestionType.Judgment]: extractJudgeOptions,
  [QuestionType.Matching]: extractMatchingOptions,
};

/**
 * 按页面选择器提取单道题，不修改原 DOM，也不处理分页。
 * @param {Element} node 单道题容器。
 * @param {ExtractionSelectors} selectors 页面定位规则。
 * @param {Element|null} [titleNode] 结构解析时传入跨兄弟节点的题干片段。
 * @returns {Question}
 */
export const extractQuestion = (
  node,
  selectors,
  titleNode = node.querySelector(selectors.title),
) => {
  const kind =
    selectors.kindName ??
    text(node.querySelector(selectors.kind)).match(/[\u4e00-\u9fff]+/)[0];
  const title = /** @type {Element|null} */ (titleNode?.cloneNode(true));
  assert(title, "未找到题干");
  title.querySelector(selectors.titleMeta)?.remove();
  const number = text(node.querySelector(selectors.number)).match(
    /^[（(]?(\d+)/,
  )[1];
  /** @type {{marker: string, url: string}[]} */
  const images = [];
  return {
    id: number,
    kind: kind,
    stem: extractContent(title, images).replace(
      /^(?:\d+\s*[.．、]|[（(]\d+[)）])\s*/,
      "",
    ),
    options:
      optionExtractors[classifyQuestion(kind)]?.(node, selectors, images) ?? [],
    images,
  };
};

/**
 * 读取页面中 font-cxsecret 的内嵌字体，保持原字体字节供后端解密。
 * @param {Document} document 题目所属文档。
 * @returns {number[]|null}
 */
export const extractFont = (document) => {
  const styles = Array.from(
    document.querySelectorAll(SELECTORS.workExam.fontStyles),
    (style) => style.textContent,
  ).join("\n");
  const match = styles.match(
    /@font-face\s*\{[^}]*font-family\s*:\s*['"]font-cxsecret['"][^}]*src\s*:\s*url\(\s*['"]data:application\/font-ttf[^,]*,([^'")]+)['"]\s*\)/,
  );
  return match
    ? Array.from(atob(match[1]), (character) => character.charCodeAt(0))
    : null;
};

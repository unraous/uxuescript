import { assert } from "@injected/utils/async.js";
import {
  extractFont,
  extractQuestion,
  extractContent,
  classifyQuestion,
} from "./extract.js";
import { QuestionType } from "./types.js";

/**
 * @typedef {import("../../../src/services/cmds").Folio_Deserialize} Folio
 * @typedef {import("../../../src/services/cmds").Entry_Deserialize} Entry
 * @typedef {import("../../../src/services/cmds").Section_Deserialize} Section
 * @typedef {typeof import("../selectors.js").SELECTORS.workExam | typeof import("../selectors.js").SELECTORS.quiz} PageSelectors
 * @typedef {Pick<PageSelectors, "kind" | "choice" | "clearSelectedClass" | "textInputs" | "textSave"> & {kindName?: string}} FillingSelectors
 * @typedef {import("./extract.js").ExtractionSelectors & FillingSelectors & Pick<PageSelectors, "folio" | "blanks">} QuestionSelectors
 */

/**
 * 锚点只存在于当前页面；不属于发送或持久化的卷面数据。
 * 一道多空题的 node 包含该题全部输入位置。
 * @typedef {Object} Anchor
 * @property {Element} node 当前题目的答题范围。
 * @property {FillingSelectors} selectors 该范围内的填写定位规则。
 */

/**
 * 作业富文本可能被浏览器解析成标题后面的兄弟节点，读取到答题区域为止。
 * @param {Element} node
 * @param {QuestionSelectors} selectors
 */
const readTitle = (node, selectors) => {
  const title = node.querySelector(selectors.title);
  assert(title, "未找到题干");
  const fragment = node.ownerDocument.createElement("div");
  for (
    let sibling = title;
    sibling && !sibling.matches(selectors.folio.titleEnd);
    sibling = sibling.nextElementSibling
  ) {
    fragment.append(sibling.cloneNode(true));
    fragment.append(" ");
  }
  for (const element of fragment.querySelectorAll("script, style, input")) {
    element.remove();
  }
  return fragment;
};

/**
 * 提取共用选项及子题；选项正文归公共材料，子题只保留可点击的标识。
 * @param {Element} node
 * @param {import("./extract.js").Question} question
 * @param {QuestionSelectors} selectors
 * @param {NonNullable<QuestionSelectors["folio"]["shared"]>} shared
 * @param {Map<string, Anchor>} anchors
 * @returns {Entry}
 */
const parseShared = (node, question, selectors, shared, anchors) => {
  const options = [];
  for (const option of node.querySelectorAll(shared.options)) {
    const label = option
      .querySelector(shared.label)
      .textContent.trim()
      .replace(/\.$/, "");
    options.push(
      `${label} ${extractContent(option.querySelector(shared.text), question.images)}`,
    );
  }
  const itemSelectors = {
    ...selectors,
    ...shared.item,
    choice: { ...selectors.choice, ...shared.item.choice },
  };
  /** @type {Entry[]} */
  const entries = [];
  for (const item of node.querySelectorAll(shared.items)) {
    const child = extractQuestion(
      item,
      itemSelectors,
      readTitle(item, itemSelectors),
    );
    child.id = `${question.id}.${child.id}`;
    child.options = Array.from(
      item.querySelectorAll(itemSelectors.choice.single),
      (option) => option.getAttribute(itemSelectors.choice.attribute),
    );
    anchors.set(child.id, { node: item, selectors: itemSelectors });
    entries.push({ type: "question", data: child });
  }
  return {
    type: "section",
    data: {
      title: `${question.id}. ${question.kind}`,
      passage: {
        text: [question.stem, "共用备选答案：", ...options].join("\n"),
        images: question.images,
      },
      entries,
    },
  };
};

/**
 * @param {Element} node
 * @param {QuestionSelectors} selectors
 * @param {string[]} path 祖先题组的显示编号。
 * @param {Map<string, Anchor>} anchors
 * @returns {Entry}
 */
const parseEntry = (node, selectors, path, anchors) => {
  const question = extractQuestion(node, selectors, readTitle(node, selectors));
  const position = [...path, question.id];
  question.id = position.join(".");
  const { folio } = selectors;
  if (folio.shared && node.querySelector(folio.shared.container))
    return parseShared(node, question, selectors, folio.shared, anchors);
  const reading = node.querySelector(folio.reading);
  if (reading) {
    const itemSelectors = {
      ...selectors,
      ...folio.item,
      choice: { ...selectors.choice, ...folio.item.choice },
    };
    return {
      type: "section",
      data: {
        title: `${question.id}. ${question.kind}`,
        passage: { text: question.stem, images: question.images },
        entries: Array.from(reading.querySelectorAll(folio.items), (item) =>
          parseEntry(item, itemSelectors, position, anchors),
        ),
      },
    };
  }

  const { kind, choice, clearSelectedClass, textInputs, textSave } = selectors;
  if (classifyQuestion(question.kind) === QuestionType.Completion) {
    // 章节结果页保留空位容器但不再含编辑器，解析空数不依赖页面是否可编辑。
    question.blank_count =
      node.querySelectorAll(selectors.blanks).length ||
      node.querySelectorAll(textInputs).length;
    assert(question.blank_count > 0, `填空题 ${question.id} 未找到空位`);
  }
  anchors.set(question.id, {
    node,
    selectors: { kind, choice, clearSelectedClass, textInputs, textSave },
  });
  return { type: "question", data: question };
};

/**
 * 根据页面结构解析卷、篇、文、题，同时建立前端填写锚点；不发起求解或修改 DOM。
 * @param {Document|Element} root 页面题目所在范围。
 * @param {PageSelectors} selectors
 * @returns {{folio: Folio, anchors: Map<string, Anchor>}}
 */
export const parseFolio = (root, selectors) => {
  const doc =
    root.nodeType === 9 ? /** @type {Document} */ (root) : root.ownerDocument;
  /** @type {Folio} */
  const folio = { entries: [], font: extractFont(doc), context: {} };
  /** @type {Map<string, Anchor>} */
  const anchors = new Map();
  const headings = Array.from(root.querySelectorAll(selectors.folio.section));
  /** @type {Element|undefined} */
  let currentHeading;
  /** @type {Section|null} */
  let section = null;

  for (const node of root.querySelectorAll(selectors.question)) {
    const title = node.querySelector(selectors.title);
    assert(title, "未找到题干");
    // 考试的分区标题在首题容器内部，按题干而非外层容器的位置判断归属。
    const heading = headings.findLast(
      (item) =>
        item.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    if (heading && heading !== currentHeading) {
      section = {
        title: heading.textContent.replace(/\s+/g, " ").trim(),
        passage: null,
        entries: [],
      };
      folio.entries.push({ type: "section", data: section });
      currentHeading = heading;
    }
    const entries = section ? section.entries : folio.entries;
    entries.push(parseEntry(node, selectors, [], anchors));
  }
  return { folio, anchors };
};

/** @param {Entry[]} entries @returns {import("./extract.js").Question[]} */
export const questions = (entries) =>
  entries.flatMap((entry) =>
    entry.type === "question" ? [entry.data] : questions(entry.data.entries),
  );

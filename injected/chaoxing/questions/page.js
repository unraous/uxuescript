import { cooldown } from "@injected/chaoxing/runtime.js";
import { wait } from "@injected/utils/async.js";
import { invoke } from "@injected/utils/backend.js";
import { classifyQuestion } from "./extract.js";
import { parseFolio, questions } from "./folio.js";
import { readContext } from "./context.js";
import { fillAnswer } from "./fill.js";
import { fillMatching } from "./matching.js";
import { QuestionType } from "./types.js";

/** @param {import("./folio.js").Entry[]} entries @returns {import("./folio.js").Entry[]} */
const supportedEntries = (entries) =>
  entries.flatMap(
    /** @returns {import("./folio.js").Entry[]} */ (entry) => {
      if (entry.type === "question") {
        return classifyQuestion(entry.data.kind) === QuestionType.Other
          ? []
          : [entry];
      }
      const children = supportedEntries(entry.data.entries);
      return children.length
        ? [{ type: "section", data: { ...entry.data, entries: children } }]
        : [];
    },
  );

/** @param {import("./folio.js").Folio} folio @returns {Promise<import("../../../src/services/cmds").AnswerItem[]>} */
export const solveFolio = async (folio) => {
  const entries = supportedEntries(folio.entries);
  return entries.length
    ? invoke("solve_questions", { payload: { ...folio, entries } })
    : [];
};

/**
 * 按题号定位并填写答案。
 * @param {import("./folio.js").Folio} folio
 * @param {Map<string, import("./folio.js").Anchor>} anchors
 * @param {import("../../../src/services/cmds").AnswerItem[]} answers
 * @returns {Promise<string[]>} 需人工处理的题号。
 */
export const applyAnswers = async (folio, anchors, answers) => {
  const leaves = questions(folio.entries);
  const byNumber = new Map(answers.map((answer) => [answer.index, answer]));
  const skipped = [];
  for (const question of leaves) {
    const kind = classifyQuestion(question.kind);
    if (kind === QuestionType.Other) {
      skipped.push(`${question.id}（${question.kind}）`);
      continue;
    }
    const { node, selectors } = anchors.get(question.id);
    const answer = byNumber.get(question.id);
    if (kind === QuestionType.Matching) {
      await cooldown();
      fillMatching(node, question.options, answer.content);
    } else await fillAnswer(node, answer.content, selectors);
  }
  return skipped;
};

/**
 * 整页解析、求解与回填；保存由页面入口处理。
 * @param {Document|Element} root
 * @param {import("./folio.js").PageSelectors} selectors
 */
export const answerPage = async (root, selectors) => {
  await wait.elements(null, selectors.question, root);
  const { folio, anchors } = parseFolio(root, selectors);
  const doc =
    root.nodeType === 9 ? /** @type {Document} */ (root) : root.ownerDocument;
  folio.context = await readContext(doc);
  return applyAnswers(folio, anchors, await solveFolio(folio));
};

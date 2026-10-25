import { cooldown } from "@injected/chaoxing/runtime.js";
import { wait } from "@injected/utils/async.js";
import { invoke } from "@injected/utils/backend.js";
import { extractPayload, classifyQuestion } from "./extract.js";
import { fillAnswer } from "./fill.js";
import { fillMatching } from "./matching.js";
import { QuestionType } from "./types.js";
import { controller } from "@injected/chaoxing/safety.js";

/**
 * 整页提取、求解并按显示题号填写；保存由页面入口处理。
 * @param {Document|Element} root 题目所在范围。
 * @param {typeof import("../selectors.js").SELECTORS.workExam} selectors 页面选择器。
 * @returns {Promise<string[]>} 留给人工处理的题号和题型。
 */
export const answerPage = async (root, selectors) => {
  const nodes = await wait.elements(null, selectors.question, root);
  const doc =
    root.nodeType === 9 ? /** @type {Document} */ (root) : root.ownerDocument;
  const payload = extractPayload(doc, nodes, selectors);
  const supported = payload.questions.filter(
    (question) => classifyQuestion(question.kind) !== QuestionType.Other,
  );
  const answers = supported.length
    ? await invoke("solve_questions", {
        payload: { ...payload, questions: supported },
      })
    : [];
  const byNumber = new Map(answers.map((answer) => [answer.index, answer]));
  const skipped = [];
  for (const [index, node] of nodes.entries()) {
    await controller.checkpoint();
    const question = payload.questions[index];
    const kind = classifyQuestion(question.kind);
    if (kind === QuestionType.Other) {
      skipped.push(`${question.id}（${question.kind}）`);
    } else {
      const answer = byNumber.get(question.id);
      await cooldown();
      if (kind === QuestionType.Matching)
        fillMatching(node, question.options, answer.content);
      else await fillAnswer(node, answer.content, selectors);
    }
  }
  return skipped;
};

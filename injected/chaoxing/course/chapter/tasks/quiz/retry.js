import { assert } from "@injected/utils/async.js";
import { classifyQuestion } from "@injected/chaoxing/questions/extract.js";
import { fillAnswer } from "@injected/chaoxing/questions/fill.js";
import { QuestionType } from "@injected/chaoxing/questions/types.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";

/** @typedef {{answer: string, mark: string}} Feedback */
/** @typedef {{wrong: Set<string>, right: string|null, half: string|null}} QuestionState */
/** @typedef {{questions: QuestionState[], combinations: Set<string>, firstAnswers: string[]}} RetryState */

/** @returns {RetryState} */
export const createRetryState = () => ({
  questions: [],
  combinations: new Set(),
  firstAnswers: [],
});

/** @param {Element} node */
const optionsFor = (node) => {
  const kind = classifyQuestion(
    node.querySelector(SELECTORS.quiz.kind).textContent,
  );
  const selector =
    kind === QuestionType.MultipleChoice
      ? SELECTORS.quiz.choice.multiple
      : SELECTORS.quiz.choice.single;
  const options = Array.from(node.querySelectorAll(selector));
  const labels = options.map((option, index) =>
    kind === QuestionType.Judgment
      ? String.fromCharCode(65 + index)
      : option.getAttribute("data"),
  );
  return { kind, options, labels };
};

/** @param {Element} node */
const selectedAnswer = (node) => {
  const { options, labels } = optionsFor(node);
  return options
    .filter((option) => option.matches(SELECTORS.quiz.clearSelectedClass))
    .map((option) => labels[options.indexOf(option)])
    .join("");
};

/** @param {Element} node @returns {Feedback|null} */
const readFeedback = (node) => {
  const box = node.querySelector(SELECTORS.quiz.answerBox);
  if (!box) return null;
  const answer = box.querySelector(SELECTORS.quiz.answerContent);
  if (!answer) return null;
  const mark = box.querySelector(SELECTORS.quiz.wrong)
    ? "wrong"
    : box.querySelector(SELECTORS.quiz.right)
      ? "right"
      : box.querySelector(SELECTORS.quiz.half)
        ? "half"
        : "";
  assert(mark, "测验答案反馈缺少判分标记");
  const { kind, labels } = optionsFor(node);
  const text = answer.textContent.trim().replace(/^我的答案[：:]\s*/, "");
  if (kind === QuestionType.Judgment) {
    return { answer: /^(对|正确|true|A)/i.test(text) ? "A" : "B", mark };
  }
  return {
    answer: labels.filter((label) => text.includes(label)).join(""),
    mark,
  };
};

/** @param {Document} doc @param {RetryState} state */
export const recordSubmission = (doc, state) => {
  const nodes = Array.from(doc.querySelectorAll(SELECTORS.quiz.question));
  const answers = nodes.map(selectedAnswer);
  if (!state.combinations.size) state.firstAnswers = answers;
  state.combinations.add(JSON.stringify(answers));
};

/** @param {Element} node @param {QuestionState} state */
const candidatesFor = (node, state) => {
  const { kind, labels } = optionsFor(node);
  if (
    ![
      QuestionType.SingleChoice,
      QuestionType.MultipleChoice,
      QuestionType.Judgment,
    ].includes(kind)
  )
    return [""];
  const max =
    kind === QuestionType.MultipleChoice
      ? 2 ** labels.length
      : labels.length + 1;
  /** @type {string[]} */
  const candidates = [];
  for (let i = 1; i < max; i++) {
    const answer =
      kind === QuestionType.MultipleChoice
        ? labels
            .filter((_label, index) => Math.floor(i / 2 ** index) % 2)
            .join("")
        : labels[i - 1];
    if (state.right && answer !== state.right) continue;
    if (state.wrong.has(answer)) continue;
    if (state.half && ![...state.half].every((label) => answer.includes(label)))
      continue;
    candidates.push(answer);
  }
  return candidates;
};

/** @param {Element[]} nodes @param {RetryState} state */
const updateFeedback = (nodes, state) => {
  for (const [index, node] of nodes.entries()) {
    const question = state.questions[index];
    const feedback = readFeedback(node);
    if (!feedback) continue;
    const kind = classifyQuestion(
      node.querySelector(SELECTORS.quiz.kind).textContent,
    );
    assert(
      [
        QuestionType.SingleChoice,
        QuestionType.MultipleChoice,
        QuestionType.Judgment,
      ].includes(kind) || feedback.mark === "right",
      `第 ${index + 1} 题无法根据反馈自动修补`,
    );
    if (feedback.mark !== "right")
      assert(feedback.answer, `第 ${index + 1} 题无法识别反馈答案`);
    if (feedback.mark === "right") question.right = feedback.answer;
    if (feedback.mark === "wrong") question.wrong.add(feedback.answer);
    if (feedback.mark === "half") {
      question.half = feedback.answer;
      question.wrong.add(feedback.answer);
    }
  }
};

/** @param {Element[]} nodes @param {RetryState} state @param {boolean} hasFeedback */
const chooseAnswers = (nodes, state, hasFeedback) => {
  const candidates = nodes.map((node, index) =>
    candidatesFor(node, state.questions[index]),
  );
  assert(
    candidates.every((list) => list.length),
    "测验可尝试的答案已用尽",
  );
  const order = nodes.map((_, index) => index);
  if (!hasFeedback) {
    const kinds = nodes.map((node) => optionsFor(node).kind);
    for (const [index, list] of candidates.entries()) {
      if (kinds[index] !== QuestionType.MultipleChoice) continue;
      list.sort((a, b) => b.length - a.length);
      const first = list.indexOf(state.firstAnswers[index]);
      if (first >= 0) list.unshift(...list.splice(first, 1));
    }
    order.sort(
      (a, b) =>
        Number(kinds[b] === QuestionType.MultipleChoice) -
        Number(kinds[a] === QuestionType.MultipleChoice),
    );
  }
  const indexes = candidates.map(() => 0);
  let answers = candidates.map((list) => list[0]);
  while (state.combinations.has(JSON.stringify(answers))) {
    let position = order.length - 1;
    while (
      position >= 0 &&
      ++indexes[order[position]] >= candidates[order[position]].length
    )
      indexes[order[position--]] = 0;
    assert(position >= 0, "测验可尝试的答案组合已用尽");
    answers = candidates.map((list, i) => list[indexes[i]]);
  }
  return answers;
};

/** @param {Document} doc @param {RetryState} state @param {boolean} hasFeedback */
export const fillRetry = async (doc, state, hasFeedback) => {
  const nodes = Array.from(doc.querySelectorAll(SELECTORS.quiz.question));
  assert(nodes.length, "重做页面未找到测验题目");
  for (const [index] of nodes.entries()) {
    state.questions[index] ??= { wrong: new Set(), right: null, half: null };
  }
  if (hasFeedback) updateFeedback(nodes, state);
  const answers = chooseAnswers(nodes, state, hasFeedback);
  for (const [index, answer] of answers.entries()) {
    if (answer) await fillAnswer(nodes[index], answer, SELECTORS.quiz);
  }
};

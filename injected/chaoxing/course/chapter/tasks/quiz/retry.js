import { assert } from "@injected/utils/async.js";
import { answerCandidates } from "@injected/chaoxing/questions/candidates.js";
import { classifyQuestion } from "@injected/chaoxing/questions/extract.js";
import { fillAnswer } from "@injected/chaoxing/questions/fill.js";
import { QuestionType } from "@injected/chaoxing/questions/types.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";

/** @typedef {{answer: string, mark: string}} Feedback */
/** @typedef {{kind: number, candidates: string[], answer: string, wrong: Set<string>, right: string|null, half: string|null}} QuestionState */
/** @typedef {{questions: QuestionState[], combinations: Set<string>}} RetryState */

/** @returns {RetryState} */
export const createRetryState = () => ({
  questions: [],
  combinations: new Set(),
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

/** @param {Element} node @returns {QuestionState} */
const createQuestion = (node) => {
  const { kind, labels } = optionsFor(node);
  const supported = [
    QuestionType.SingleChoice,
    QuestionType.MultipleChoice,
    QuestionType.Judgment,
  ].includes(kind);
  const firstAnswer = selectedAnswer(node);
  const candidates = supported
    ? answerCandidates(labels, kind).map((selection) => selection.join(""))
    : [""];
  const first = candidates.indexOf(firstAnswer);
  if (first >= 0) candidates.unshift(...candidates.splice(first, 1));
  return {
    kind,
    candidates,
    answer: firstAnswer,
    wrong: new Set(),
    right: null,
    half: null,
  };
};

/** @param {Document} doc @param {RetryState} state */
export const recordSubmission = (doc, state) => {
  const nodes = Array.from(doc.querySelectorAll(SELECTORS.quiz.question));
  if (!state.questions.length) state.questions = nodes.map(createQuestion);
  const answers = nodes.map(selectedAnswer);
  for (const [index, answer] of answers.entries())
    state.questions[index].answer = answer;
  state.combinations.add(JSON.stringify(answers));
};

/** @param {QuestionState} question */
const candidatesFor = (question) =>
  question.candidates.filter((answer) => {
    if (question.right && answer !== question.right) return false;
    if (question.wrong.has(answer)) return false;
    if (
      question.half &&
      ![...question.half].every((label) => answer.includes(label))
    )
      return false;
    return true;
  });

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

/** @param {QuestionState} question */
const orderedCandidates = (question) => {
  const candidates = candidatesFor(question);
  if (question.kind !== QuestionType.MultipleChoice) {
    const current = candidates.indexOf(question.answer);
    if (current >= 0) candidates.unshift(...candidates.splice(current, 1));
  }
  return candidates;
};

/** @param {RetryState} state */
const chooseAnswers = (state) => {
  // Later questions vary first: preserve multiple-choice answers while trying
  // the single-choice and judgment combinations.
  const questions = state.questions.map((question, index) => ({
    question,
    index,
  }));
  questions.sort(
    (a, b) =>
      Number(b.question.kind === QuestionType.MultipleChoice) -
      Number(a.question.kind === QuestionType.MultipleChoice),
  );
  const answers = state.questions.map((question) => question.answer);

  /** @param {number} position @returns {boolean} */
  const select = (position) => {
    if (position === questions.length)
      return !state.combinations.has(JSON.stringify(answers));
    const { question, index } = questions[position];
    const candidates = orderedCandidates(question);
    assert(candidates.length, "测验可尝试的答案已用尽");
    for (const answer of candidates) {
      answers[index] = answer;
      if (select(position + 1)) return true;
    }
    return false;
  };

  assert(select(0), "测验可尝试的答案组合已用尽");
  return answers;
};

/** @param {Document} doc @param {RetryState} state @param {boolean} hasFeedback */
export const fillRetry = async (doc, state, hasFeedback) => {
  const nodes = Array.from(doc.querySelectorAll(SELECTORS.quiz.question));
  assert(nodes.length, "重做页面未找到测验题目");
  if (hasFeedback) updateFeedback(nodes, state);
  const answers = chooseAnswers(state);
  for (const [index, answer] of answers.entries()) {
    if (answer) await fillAnswer(nodes[index], answer, SELECTORS.quiz);
  }
};

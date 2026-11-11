import { QuestionType } from "./types.js";

/** @param {string[]} options */
const singleCandidates = (options) => options.map((option) => [option]);

/** @param {string[]} options */
const multipleCandidates = (options) => {
  /** @type {string[][]} */
  const candidates = [];
  for (const option of options) {
    const previous = candidates.slice();
    candidates.push([option]);
    for (const candidate of previous) candidates.push([...candidate, option]);
  }
  return candidates.sort((a, b) => b.length - a.length);
};

/** @type {Partial<Record<QuestionType, (options: string[]) => string[][]>>} */
const candidateGenerators = {
  [QuestionType.SingleChoice]: singleCandidates,
  [QuestionType.MultipleChoice]: multipleCandidates,
  [QuestionType.Judgment]: singleCandidates,
};

/**
 * Generate nonempty selections in descending order of option count.
 * @param {string[]} options
 * @param {QuestionType} kind
 * @returns {string[][]}
 */
export const answerCandidates = (options, kind) => {
  const generate = candidateGenerators[kind];
  if (!generate) throw new Error(`不支持生成候选答案的题型: ${kind}`);
  return generate(options);
};

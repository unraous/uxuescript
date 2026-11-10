import { describe, expect, it } from "vitest";
import {
  createRetryState,
  fillRetry,
  recordSubmission,
} from "@injected/chaoxing/course/chapter/tasks/quiz/retry.js";

/** @param {string} kind @param {string[]} options @param {string} selected @param {string} [feedback] */
const question = (kind, options, selected, feedback = "") => `
  <div class="singleQuesId">
    <div class="newZy_TItle">${kind}</div>
    ${options.map((label) => `<span data="${label}" class="${kind === "多选" ? "num_option_dx" : "num_option"} ${selected.includes(label) ? (kind === "多选" ? "check_answer_dx" : "check_answer") : ""}"></span>`).join("")}
    ${feedback}
  </div>`;
/** @param {string} answer @param {string} mark */
const feedback = (answer, mark) =>
  `<div class="newAnswerBx"><div class="answerCon">${answer}</div><i class="marking_${mark}"></i></div>`;
/** @param {string} html */
const page = (html) => {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = html;
  for (const node of doc.querySelectorAll(".num_option, .num_option_dx")) {
    node.addEventListener("click", () => {
      node.classList.toggle(
        node.classList.contains("num_option_dx")
          ? "check_answer_dx"
          : "check_answer",
      );
    });
  }
  return doc;
};
/** @param {Document} doc */
const selected = (doc) =>
  Array.from(doc.querySelectorAll(".singleQuesId"), (node) =>
    Array.from(
      node.querySelectorAll(".check_answer, .check_answer_dx"),
      (option) => option.getAttribute("data"),
    ).join(""),
  );

describe("chapter quiz retry", () => {
  it("retains correct answers and changes wrong answers using feedback", async () => {
    const state = createRetryState();
    const first = page(
      question("单选", ["A", "B", "C"], "B") +
        question("多选", ["A", "B", "C"], "AB"),
    );
    recordSubmission(first, state);
    const result = page(
      question("单选", ["A", "B", "C"], "B", feedback("B", "dui")) +
        question("多选", ["A", "B", "C"], "AB", feedback("A,B", "cuo")),
    );
    await fillRetry(result, state, true);
    expect(selected(result)).toEqual(["B", "A"]);
    recordSubmission(result, state);
    const next = page(
      question("单选", ["A", "B", "C"], "B", feedback("B", "dui")) +
        question("多选", ["A", "B", "C"], "A", feedback("A", "bandui")),
    );
    await fillRetry(next, state, true);
    expect(selected(next)).toEqual(["B", "AC"]);
  });
  it("tries distinct combinations when there is no feedback and stops after exhaustion", async () => {
    const state = createRetryState();
    const doc = page(
      question("单选", ["A", "B"], "A") + question("单选", ["A", "B"], "A"),
    );
    const attempts = [];
    for (let i = 0; i < 4; i++) {
      attempts.push(selected(doc).join("-"));
      recordSubmission(doc, state);
      if (i < 3) await fillRetry(doc, state, false);
    }
    expect(attempts).toEqual(["A-A", "A-B", "B-A", "B-B"]);
    await expect(fillRetry(doc, state, false)).rejects.toThrow(
      "答案组合已用尽",
    );
  });
});

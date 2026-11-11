import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "@injected/chaoxing/runtime.js";
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

/** @type {number|null} */
let originalCd;
beforeEach(() => {
  originalCd = config.switchingCd;
  config.switchingCd = null;
});
afterEach(() => {
  config.switchingCd = originalCd;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("chapter quiz retry", () => {
  it("waits before filling each retry answer", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    config.switchingCd = 1;
    const doc = page(
      question("单选", ["A", "B"], "B") + question("单选", ["A", "B"], "B"),
    );
    const state = createRetryState();
    recordSubmission(doc, state);
    const run = fillRetry(doc, state, false);
    await vi.advanceTimersByTimeAsync(999);
    expect(selected(doc)).toEqual(["B", "B"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(selected(doc)).toEqual(["B", "B"]);
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    expect(selected(doc)).toEqual(["B", "A"]);
  });
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
    expect(selected(result)).toEqual(["B", "ABC"]);
    recordSubmission(result, state);
    const next = page(
      question("单选", ["A", "B", "C"], "B", feedback("B", "dui")) +
        question("多选", ["A", "B", "C"], "ABC", feedback("A,B,C", "cuo")),
    );
    await fillRetry(next, state, true);
    expect(selected(next)).toEqual(["B", "AC"]);
  });
  it("extends a partially correct multiple-choice answer", async () => {
    const state = createRetryState();
    const first = page(question("多选", ["A", "B", "C"], "A"));
    recordSubmission(first, state);
    const result = page(
      question("多选", ["A", "B", "C"], "A", feedback("A", "bandui")),
    );
    await fillRetry(result, state, true);
    expect(selected(result)).toEqual(["ABC"]);
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
    expect(attempts).toEqual(["A-A", "A-B", "B-B", "B-A"]);
    await expect(fillRetry(doc, state, false)).rejects.toThrow(
      "答案组合已用尽",
    );
  });
  it("keeps the first multiple-choice answer while trying single choices, then tries larger sets first", async () => {
    const state = createRetryState();
    const doc = page(
      question("单选", ["A", "B"], "B") +
        question("多选", ["A", "B", "C"], "AC") +
        question("单选", ["A", "B"], "B"),
    );
    recordSubmission(doc, state);
    const attempts = [];
    for (let i = 0; i < 27; i++) {
      await fillRetry(doc, state, false);
      attempts.push(selected(doc));
      recordSubmission(doc, state);
    }
    expect(attempts.slice(0, 3)).toEqual([
      ["B", "AC", "A"],
      ["A", "AC", "A"],
      ["A", "AC", "B"],
    ]);
    expect(
      attempts.filter((_, index) => index % 4 === 3).map((answer) => answer[1]),
    ).toEqual(["ABC", "AB", "BC", "A", "B", "C"]);
    await expect(fillRetry(doc, state, false)).rejects.toThrow(
      "答案组合已用尽",
    );
  });
});

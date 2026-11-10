import { afterEach, describe, expect, it, vi } from "vitest";
import { handleQuiz } from "@injected/chaoxing/course/chapter/tasks/quiz.js";
import { config } from "@injected/chaoxing/runtime.js";
import { wait } from "@injected/utils/async.js";
import { answerPage } from "@injected/chaoxing/questions/page.js";
import { confirm } from "@injected/utils/backend.js";

vi.mock("@injected/chaoxing/questions/page.js", () => ({
  answerPage: vi.fn(),
}));
vi.mock("@injected/utils/backend.js", () => ({ confirm: vi.fn() }));

/** @param {boolean} failed @param {string} selected */
const quizPage = (failed, selected) => {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = `${failed ? '<div class="testTit_status">未达到及格线请重做</div>' : ""}
    <div class="singleQuesId"><div class="newZy_TItle">单选题</div>
    <span data="A" class="num_option ${selected === "A" ? "check_answer" : ""}"></span>
    <span data="B" class="num_option ${selected === "B" ? "check_answer" : ""}"></span>
    ${failed ? '<div class="newAnswerBx"><i class="marking_cuo"></i></div>' : ""}</div>
    <a class="btnSubmit"></a>`;
  for (const option of doc.querySelectorAll(".num_option")) {
    option.addEventListener("click", () =>
      option.classList.toggle("check_answer"),
    );
  }
  return doc;
};

/** @param {Document[]} pages @param {boolean} [delayed] */
const setup = (pages, delayed = false) => {
  const container = document.createElement("div");
  const taskDoc = document.implementation.createHTMLDocument();
  taskDoc.body.innerHTML = '<iframe id="frame_content"></iframe>';
  const frame = taskDoc.querySelector("iframe");
  let current = 0;
  Object.defineProperty(frame, "contentDocument", {
    get: () => pages[current],
  });
  document.body.innerHTML =
    '<div id="workpop" style="display:none"><div id="popcontent"></div><a id="popok"></a></div>';
  const modal = document.querySelector("#workpop");
  /** @type {(string|null|undefined)[]} */
  const attempts = [];
  for (const page of pages) {
    page.querySelector(".btnSubmit").addEventListener("click", () => {
      attempts.push(page.querySelector(".check_answer")?.getAttribute("data"));
      modal.setAttribute("style", "display:block");
    });
  }
  document.querySelector("#popok").addEventListener("click", () => {
    modal.setAttribute("style", "display:none");
    if (current === pages.length - 1)
      container.classList.add("ans-job-finished");
    else if (delayed) window.setTimeout(() => current++, 25);
    else current++;
  });
  vi.spyOn(wait, "iframeDoc").mockResolvedValue(pages[0]);
  vi.spyOn(wait, "element").mockImplementation(
    async (_action, selector, root) =>
      /** @type {HTMLElement} */ (root.querySelector(selector)),
  );
  vi.spyOn(wait, "until").mockImplementation(async (getter) => {
    for (let i = 0; i < 10; i++) {
      const value = await getter();
      if (value) return value;
    }
    return null;
  });
  Object.assign(config, { quizReview: false, debugTaskTypes: [] });
  vi.mocked(answerPage).mockResolvedValue([]);
  return { run: () => handleQuiz(taskDoc, container), attempts, container };
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("chapter quiz submission loop", () => {
  it("records the manually reviewed answer and retries without answer feedback until the task is complete", async () => {
    const first = quizPage(false, "A");
    const result = quizPage(true, "B");
    const flow = setup([first, result]);
    config.quizReview = true;
    vi.mocked(confirm).mockImplementation(async () => {
      if (!flow.attempts.length) {
        /** @type {HTMLElement} */ (first.querySelector('[data="A"]')).click();
        /** @type {HTMLElement} */ (first.querySelector('[data="B"]')).click();
      }
      return true;
    });
    await flow.run();
    expect(answerPage).toHaveBeenCalledOnce();
    expect(flow.attempts).toEqual(["B", "A"]);
  });
  it("waits for an asynchronously loaded failure result", async () => {
    vi.useFakeTimers();
    const flow = setup([quizPage(false, "A"), quizPage(true, "A")], true);
    vi.mocked(wait.until).mockRestore();
    const run = flow.run();
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    expect(flow.attempts).toEqual(["A", "B"]);
  });
  it("runs a completed task once in debug mode", async () => {
    const flow = setup([quizPage(false, "A")]);
    flow.container.classList.add("ans-job-finished");
    config.debugTaskTypes = ["Quiz"];
    vi.mocked(confirm).mockResolvedValue(true);
    await flow.run();
    expect(answerPage).toHaveBeenCalledOnce();
    expect(flow.attempts).toEqual(["A"]);
  });
  it("uses the grading feedback on an already failed page", async () => {
    const page = quizPage(true, "A");
    const answer = page.createElement("div");
    answer.className = "answerCon";
    answer.textContent = "A";
    page.querySelector(".newAnswerBx").append(answer);
    const flow = setup([page]);
    await flow.run();
    expect(answerPage).not.toHaveBeenCalled();
    expect(flow.attempts).toEqual(["B"]);
  });
  it("starts with retry when the page is already failed", async () => {
    const flow = setup([quizPage(true, "A")]);
    await flow.run();
    expect(answerPage).not.toHaveBeenCalled();
    expect(flow.attempts).toEqual(["B"]);
  });
});

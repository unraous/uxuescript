import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleQuiz } from "@injected/chaoxing/course/chapter/tasks/quiz.js";
import { config } from "@injected/chaoxing/runtime.js";
import { wait } from "@injected/utils/async.js";
import * as backend from "@injected/utils/backend.js";
const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));
vi.mock("@injected/utils/backend.js", () => ({
  invoke: invokeMock,
  confirm: vi.fn(),
}));
/**
 * @param {boolean} enabled
 * @param {(message: string) => boolean | Promise<boolean>} confirm
 */
async function setup(enabled, confirm) {
  const container = document.createElement("div");
  const submit = vi.fn(() => container.classList.add("ans-job-finished"));
  const setTimeout = vi.spyOn(window, "setTimeout");
  const invoke = invokeMock.mockReset().mockResolvedValue([]);
  vi.mocked(backend.confirm).mockImplementation(confirm);
  Object.assign(config, {
    quizReview: enabled,
    debugTaskTypes: [],
    switchingCd: null,
  });
  const quizDoc = document.implementation.createHTMLDocument();
  quizDoc.body.innerHTML =
    '<button id="submit"></button><div id="modal"><button id="ok"></button></div>';
  const submitButton = quizDoc.getElementById("submit");
  submitButton.addEventListener("click", submit);
  vi.spyOn(wait, "iframeDoc").mockResolvedValue(quizDoc);
  vi.spyOn(wait, "elements").mockResolvedValue([]);
  vi.spyOn(wait, "element").mockImplementation(async (_action, selector) => {
    const id =
      selector === "a.btnSubmit"
        ? "submit"
        : selector === "#workpop"
          ? "modal"
          : "ok";
    return quizDoc.getElementById(id);
  });
  // Submission is already covered above; this scenario skips polling the page-owned modal.
  vi.spyOn(wait, "until").mockImplementation(async () => ({
    done: true,
    doc: quizDoc,
  }));
  return {
    run: () => handleQuiz(quizDoc, container),
    submit,
    confirm: vi.mocked(confirm),
    setTimeout,
    invoke,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("manual quiz review", () => {
  it("submits without prompting or waiting when disabled", async () => {
    const page = await setup(
      false,
      vi.fn(() => false),
    );
    await page.run();
    expect(page.confirm).not.toHaveBeenCalled();
    expect(page.setTimeout).not.toHaveBeenCalled();
    expect(page.submit).toHaveBeenCalledOnce();
  });
  it("waits for Yes before submitting and explains both choices and how to stop", async () => {
    /** @type {(value: boolean) => void} */
    let choose;
    const page = await setup(
      true,
      vi.fn(
        () =>
          new Promise((resolve) => {
            choose = resolve;
          }),
      ),
    );
    const run = page.run();
    await flushPromises();
    expect(page.submit).not.toHaveBeenCalled();
    expect(page.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Yes：立即提交"),
    );
    const message = page.confirm.mock.calls[0][0];
    expect(message).toContain("No：暂不提交");
    expect(message).toContain("30 秒");
    expect(message).toContain("刷新按钮或 Home");
    expect(message).toContain("如有图片题，请确认当前模型具备视觉能力！！");
    choose(true);
    await run;
    expect(page.submit).toHaveBeenCalledOnce();
    expect(page.setTimeout).not.toHaveBeenCalled();
  });
  it("allows repeated 30-second reviews without submitting until Yes", async () => {
    vi.useFakeTimers();
    const confirm = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const page = await setup(true, confirm);
    const run = page.run();
    await flushPromises();
    expect(confirm).toHaveBeenCalledOnce();
    expect(page.submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(29999);
    expect(confirm).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(page.submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30000);
    await run;
    expect(confirm).toHaveBeenCalledTimes(3);
    expect(page.setTimeout).toHaveBeenCalledTimes(2);
    expect(page.setTimeout).toHaveBeenLastCalledWith(
      expect.any(Function),
      30000,
    );
    expect(page.submit).toHaveBeenCalledOnce();
  });
});

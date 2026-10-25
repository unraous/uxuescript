import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleQuiz } from "@injected/chaoxing/course/chapter/tasks/quiz.js";
import { ManualReviewRequired } from "@injected/chaoxing/safety.js";
import { wait } from "@injected/utils/async.js";
import * as backend from "@injected/utils/backend.js";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@injected/utils/backend.js", () => ({
  invoke: invokeMock,
  confirm: vi.fn(),
}));

/**
 * @param {(message: string) => boolean | Promise<boolean>} confirm
 */
async function setup(confirm) {
  const submit = vi.fn();
  const invoke = invokeMock.mockReset().mockResolvedValue([]);
  vi.mocked(backend.confirm).mockImplementation(confirm);
  const quizDoc = document.implementation.createHTMLDocument();
  quizDoc.body.innerHTML =
    '<p>非计分练习</p><button id="submit"></button><div id="modal"><button id="ok"></button></div>';
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
  vi.spyOn(wait, "until").mockResolvedValue(null);
  return {
    run: () => handleQuiz(quizDoc),
    submit,
    confirm: vi.mocked(backend.confirm),
    invoke,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("quiz submit authorization", () => {
  it("requires fill authorization, submit authorization and final review", async () => {
    const page = await setup(() => true);
    await page.run();
    expect(page.confirm).toHaveBeenCalledTimes(3);
    expect(page.confirm.mock.calls[0][0]).toContain("允许自动填写");
    expect(page.confirm.mock.calls[1][0]).toContain("允许自动提交");
    expect(page.confirm.mock.calls[2][0]).toContain("人工核验");
    expect(page.submit).toHaveBeenCalledOnce();
  });

  it("does not submit when final review is denied", async () => {
    let prompts = 0;
    const page = await setup(() => {
      prompts += 1;
      return prompts < 3;
    });
    const run = page.run();
    await flushPromises();
    expect(document.querySelector("#uxs-manual-review")).not.toBeNull();
    document.querySelector("#uxs-manual-review button").click();
    await expect(run).rejects.toBeInstanceOf(ManualReviewRequired);
    expect(page.submit).not.toHaveBeenCalled();
  });

  it("does not read, fill or submit when fill authorization is denied", async () => {
    const page = await setup(() => false);
    const run = page.run();
    await flushPromises();
    expect(document.querySelector("#uxs-manual-review")).not.toBeNull();
    document.querySelector("#uxs-manual-review button").click();
    await expect(run).rejects.toBeInstanceOf(ManualReviewRequired);
    expect(page.invoke).not.toHaveBeenCalled();
    expect(page.submit).not.toHaveBeenCalled();
  });
});

import { flushPromises } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { main } from "@injected/chaoxing/exam.js";
import { answerPaged } from "@injected/chaoxing/exam/paged.js";
import { fillAnswer } from "@injected/chaoxing/questions/fill.js";

vi.mock("@injected/chaoxing/exam/paged.js", () => ({ answerPaged: vi.fn() }));
vi.mock("@injected/chaoxing/questions/fill.js", () => ({
  fillAnswer: vi.fn(),
}));

const preview = vi.fn();

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("never automates a formal exam and only shows a manual notice", async () => {
  window.history.replaceState(
    null,
    "",
    "/exam-ans/exam/test/reVersionTestStartNew",
  );
  document.body.innerHTML = '<div class="mark_info">整卷预览</div>';
  vi.stubGlobal("topreview", preview);
  const run = main();
  await flushPromises();
  const panel = document.querySelector("#uxs-manual-review");
  expect(panel).not.toBeNull();
  expect(panel.textContent).toContain("正式考试已禁止自动化");
  expect(preview).not.toHaveBeenCalled();
  expect(answerPaged).not.toHaveBeenCalled();
  expect(fillAnswer).not.toHaveBeenCalled();
  panel.querySelector("button").click();
  await run;
});

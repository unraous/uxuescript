import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { main } from "@injected/chaoxing/exam.js";
import { answerPaged } from "@injected/chaoxing/exam/paged.js";
import { fillAnswer } from "@injected/chaoxing/questions/fill.js";
import { config } from "@injected/chaoxing/runtime.js";

const backend = vi.hoisted(() => ({ invoke: vi.fn(), confirm: vi.fn() }));
vi.mock("@injected/utils/backend.js", () => backend);
vi.mock("@injected/chaoxing/exam/paged.js", () => ({ answerPaged: vi.fn() }));
vi.mock("@injected/chaoxing/questions/fill.js", () => ({
  fillAnswer: vi.fn(),
}));

const preview = vi.fn();
const save = vi.fn();

beforeEach(() => {
  window.history.replaceState(
    null,
    "",
    "/exam-ans/exam/test/reVersionTestStartNew",
  );
  vi.stubGlobal("topreview", preview);
  vi.stubGlobal("submitForm", save);
  backend.confirm.mockResolvedValue(true);
  backend.invoke.mockImplementation(async (/** @type {string} */ command) =>
    command === "options"
      ? { switchingCd: null }
      : [
          { index: "2", content: "B", explanation: "" },
          { index: "1", content: "A", explanation: "" },
        ],
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  config.switchingCd = null;
});

it("enters whole-paper preview before collecting or loading configuration", async () => {
  document.body.innerHTML = '<div class="mark_info">整卷预览</div>';
  await main();
  expect(preview).toHaveBeenCalledOnce();
  expect(answerPaged).not.toHaveBeenCalled();
  expect(backend.invoke).not.toHaveBeenCalled();
  expect(fillAnswer).not.toHaveBeenCalled();
});

it("uses the paged flow when the exam forbids preview", async () => {
  document.body.innerHTML = '<div class="mark_info">不允许整卷预览</div>';
  await main();
  expect(answerPaged).toHaveBeenCalledOnce();
  expect(preview).not.toHaveBeenCalled();
});

/** 整卷页面沿 OCS 定位规则构造，仅验证本地分流、提取和填写，不模拟平台暂存。 */
function setupPreview() {
  window.history.replaceState(null, "", "/exam-ans/mooc2/exam/preview?paper=1");
  document.body.innerHTML = ["单选题", "多选题", "排序题"]
    .map(
      (kind, index) => `
    <div class="questionLi">
      <h3>${index + 1}. <span class="colorShallow">(${kind})</span>题干${index + 1}</h3>
      <div class="stem_answer"><div class="answerBg">
        <span data="A" class="num_option">A</span><div class="answer_p">选项</div>
      </div></div>
    </div>`,
    )
    .join("");
}

it("solves the full page once, fills by displayed number and reports unsupported questions", async () => {
  setupPreview();
  await main();
  expect(preview).not.toHaveBeenCalled();
  expect(answerPaged).not.toHaveBeenCalled();
  expect(backend.invoke).toHaveBeenLastCalledWith("solve_questions", {
    payload: {
      entries: [
        {
          id: "1",
          kind: "单选题",
          stem: "题干1",
          options: ["A 选项"],
          images: [],
        },
        {
          id: "2",
          kind: "多选题",
          stem: "题干2",
          options: ["A 选项"],
          images: [],
        },
      ].map((data) => ({ type: "question", data })),
      font: null,
      context: {},
    },
  });
  const nodes = document.querySelectorAll(".questionLi");
  expect(
    vi.mocked(fillAnswer).mock.calls.map(([node, content]) => [node, content]),
  ).toEqual([
    [nodes[0], "A"],
    [nodes[1], "B"],
  ]);
  expect(save).not.toHaveBeenCalled();
  expect(window.sessionStorage.length).toBe(0);
  expect(backend.confirm).toHaveBeenLastCalledWith(
    "答案已填写，请核对答案并自行保存、交卷；如有图片题，请确认当前模型具备视觉能力！！\n需人工处理的题号：3（排序题）",
  );
});

it("does not solve or fill when preview confirmation is cancelled", async () => {
  setupPreview();
  backend.confirm.mockResolvedValueOnce(false);
  await main();
  expect(backend.confirm).toHaveBeenCalledWith(
    expect.stringContaining("当前模型支持视觉输入"),
  );
  expect(backend.invoke).not.toHaveBeenCalled();
  expect(fillAnswer).not.toHaveBeenCalled();
});

it("reports preview solving failures without claiming completion", async () => {
  setupPreview();
  backend.invoke.mockImplementation(async (/** @type {string} */ command) => {
    if (command === "options") return { switchingCd: null };
    throw new Error("模型不可用");
  });
  await main();
  expect(fillAnswer).not.toHaveBeenCalled();
  expect(backend.confirm).toHaveBeenLastCalledWith("考试处理失败：模型不可用");
});

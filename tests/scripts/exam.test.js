import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { answerPaged } from "@injected/chaoxing/exam/paged.js";
import { fillAnswer } from "@injected/chaoxing/questions/fill.js";
import { config } from "@injected/chaoxing/runtime.js";

const backend = vi.hoisted(() => ({
  invoke: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@injected/utils/backend.js", () => backend);
vi.mock("@injected/chaoxing/questions/fill.js", () => ({
  fillAnswer: vi.fn(),
}));

const key = "uxs:exam:folio:paper:user";
const entries = [
  { id: "q1", start: 0 },
  { id: "q2", start: 1 },
];
const questions = entries.map((_entry, index) => ({
  id: String(index + 1),
  kind: "单选题",
  stem: "题干",
  options: ["A 选项"],
  images: /** @type {{marker: string, url: string}[]} */ ([]),
}));
/** @type {import("@injected/chaoxing/questions/folio.js").Folio[]} */
const pages = questions.map(
  /** @returns {import("@injected/chaoxing/questions/folio.js").Folio} */ (
    question,
  ) => ({
    entries: [{ type: /** @type {const} */ ("question"), data: question }],
    font: null,
    context: {},
  }),
);
/** @type {import("@injected/chaoxing/questions/folio.js").Folio} */
const payload = {
  entries: pages.flatMap((page) => page.entries),
  font: null,
  context: {},
};
const answers = [
  { index: "1", content: "A", explanation: "" },
  { index: "2", content: "B", explanation: "" },
];
const navigate = vi.fn((/** @type {number} */ start) => {
  window.history.pushState(null, "", `?question=${start}`);
});
const save = vi.fn(
  (
    /** @type {boolean} */ _save,
    /** @type {boolean} */ _submit,
    /** @type {() => void} */ callback,
  ) => callback(),
);

/**
 * @param {number} index
 * @param {import("@injected/chaoxing/exam/paged.js").ExamRun|null} run
 */
function setup(index, run) {
  document.body.innerHTML = `
    <input id="testPaperId" value="paper">
    <input id="testUserRelationId" value="user">
    <ul class="topicNumber_list">
      ${entries.map((entry) => `<li data-asq="${entry.id}" onclick="getTheQuestionByStart(${entry.start}, '0')"></li>`).join("")}
    </ul>
    <div class="questionLi singleQuesId" data="${entries[index].id}">
      <h3 class="mark_name">${index + 1}. <span class="colorShallow">(单选题)</span>题干</h3>
      <div class="stem_answer"><div class="answerBg">
        <span data="A" class="num_option">A</span><div class="answer_p">选项</div>
      </div></div>
    </div>`;
  window.history.replaceState(null, "", `?question=${index}`);
  if (run) window.sessionStorage.setItem(key, JSON.stringify(run));
}

/** @returns {import("@injected/chaoxing/exam/paged.js").ExamRun} */
function storedRun() {
  return JSON.parse(window.sessionStorage.getItem(key));
}

beforeEach(() => {
  vi.stubGlobal("getTheQuestionByStart", navigate);
  vi.stubGlobal("submitForm", save);
  backend.confirm.mockResolvedValue(true);
  backend.invoke.mockImplementation(async (/** @type {string} */ command) =>
    command === "options" ? { switchingCd: null } : answers,
  );
});

afterEach(() => {
  document.body.innerHTML = "";
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  config.switchingCd = null;
});

it("reports an error when starting outside the stored question", async () => {
  setup(1, null);
  await answerPaged();
  expect(navigate).not.toHaveBeenCalled();
  expect(fillAnswer).not.toHaveBeenCalled();
  expect(window.sessionStorage.getItem(key)).toBeNull();
  expect(backend.confirm).toHaveBeenLastCalledWith(
    expect.stringContaining("不支持手动跳题"),
  );
  expect(backend.invoke).toHaveBeenCalledExactlyOnceWith("options");
});

it("reports manual navigation instead of correcting the stored position", async () => {
  setup(0, {
    phase: "answer",
    index: 1,
    config: { switchingCd: null },
    entries,
    pages,
    answers,
  });
  await answerPaged();
  expect(navigate).not.toHaveBeenCalled();
  expect(fillAnswer).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(backend.invoke).not.toHaveBeenCalled();
  expect(backend.confirm).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining("不支持手动跳题"),
  );
});

it("collects the first question and advances without solving", async () => {
  setup(0, null);
  await answerPaged();
  expect(storedRun()).toMatchObject({
    phase: "collect",
    index: 1,
    pages: [pages[0]],
  });
  expect(navigate).toHaveBeenCalledExactlyOnceWith(1, "0");
  expect(backend.invoke).toHaveBeenCalledExactlyOnceWith("options");
});

it("solves the collected paper at the last question and returns to the first", async () => {
  setup(1, {
    phase: "collect",
    index: 1,
    config: { switchingCd: null },
    entries,
    pages: [pages[0]],
    answers: [],
  });
  await answerPaged();
  expect(backend.invoke).toHaveBeenLastCalledWith("solve_questions", {
    payload,
  });
  expect(storedRun()).toMatchObject({
    phase: "answer",
    index: 0,
    pages,
    answers,
  });
  expect(navigate).toHaveBeenCalledExactlyOnceWith(0, "0");
  expect(fillAnswer).not.toHaveBeenCalled();
});

it("fills an answer by displayed number and advances", async () => {
  config.switchingCd = 60;
  setup(0, {
    phase: "answer",
    index: 0,
    config: { switchingCd: null },
    entries,
    pages,
    answers,
  });
  await answerPaged();
  expect(fillAnswer).toHaveBeenCalledWith(
    document.querySelector(".questionLi"),
    "A",
    expect.any(Object),
  );
  expect(navigate).toHaveBeenCalledExactlyOnceWith(1, "0");
  expect(save).not.toHaveBeenCalled();
  expect(config.switchingCd).toBeNull();
  expect(backend.invoke).not.toHaveBeenCalled();
  expect(backend.confirm).not.toHaveBeenCalled();
});

it("saves the last answer and clears progress without submitting or navigating", async () => {
  setup(1, {
    phase: "answer",
    index: 1,
    config: { switchingCd: null },
    entries,
    pages,
    answers,
  });
  await answerPaged();
  expect(fillAnswer).toHaveBeenCalledWith(
    document.querySelector(".questionLi"),
    "B",
    expect.any(Object),
  );
  expect(save).toHaveBeenCalledExactlyOnceWith(
    true,
    false,
    expect.any(Function),
  );
  expect(window.sessionStorage.getItem(key)).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});

it("awaits answers before switching strategy or navigating", async () => {
  setup(1, {
    phase: "collect",
    index: 1,
    config: { switchingCd: null },
    entries,
    pages: [pages[0]],
    answers: [],
  });
  /** @type {(answers: import("../../src/services/cmds").AnswerItem[]) => void} */
  let resolveAnswers;
  const response = new Promise((resolve) => {
    resolveAnswers = resolve;
  });
  backend.invoke.mockReturnValue(response);
  const processing = answerPaged();
  await vi.waitFor(() =>
    expect(backend.invoke).toHaveBeenCalledWith("solve_questions", {
      payload,
    }),
  );
  expect(storedRun()).toMatchObject({
    phase: "collect",
    index: 1,
    pages,
    answers: [],
  });
  expect(navigate).not.toHaveBeenCalled();
  resolveAnswers(answers);
  await processing;
  expect(storedRun()).toMatchObject({ phase: "answer", index: 0, answers });
  expect(navigate).toHaveBeenCalledExactlyOnceWith(0, "0");
});

it("runs both passes from storage and fetches configuration only once", async () => {
  for (const index of [0, 1, 0, 1]) {
    // Each URL starts with a fresh runtime config and restores its own stored step.
    config.switchingCd = 60;
    setup(index, null);
    await answerPaged();
  }
  expect(backend.invoke.mock.calls.map(([command]) => command)).toEqual([
    "options",
    "solve_questions",
  ]);
  expect(navigate.mock.calls).toEqual([
    [1, "0"],
    [0, "0"],
    [1, "0"],
  ]);
  expect(fillAnswer).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenCalledExactlyOnceWith(
    true,
    false,
    expect.any(Function),
  );
  expect(backend.confirm).toHaveBeenCalledTimes(2);
  expect(backend.confirm.mock.calls[0][0]).toContain("当前模型支持视觉输入");
  expect(backend.confirm.mock.calls[1][0]).toContain(
    "如有图片题，请确认当前模型具备视觉能力！！",
  );
  expect(window.sessionStorage.getItem(key)).toBeNull();
});

import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
const stems = [
  "实现中华民族伟大复兴的必由之路是？",
  "邓小平同志为主要代表的中国共产党人如何发展中国特色社会主义？",
  "坚定道路自信、理论自信、制度自信，说到底要坚定什么？",
  "中国特色社会主义进入新时代重大判断的基本依据是？",
  "新时代我国社会主要矛盾是什么？",
  "坚持和发展中国特色社会主义的行动指南是？",
  "中国特色社会主义事业总体布局是什么？",
  "四个全面中居于引领地位的是什么？",
  "改革开放以来取得成绩和进步的根本原因是什么？",
  "我国社会主义所处历史阶段判断的依据是什么？",
  "中国特色社会主义进入新时代的重大意义是什么？",
];
function fixture() {
  document.body.innerHTML = `<form id="submitForm">${stems
    .map((stem, i) => {
      const id = String(406063260 + i);
      const kind = i < 8 ? "单选题" : i < 10 ? "多选题" : "简答题";
      const optionClass = i < 8 ? "num_option" : "num_option_dx";
      return `<div class="questionLi singleQuesId" data="${id}" typename="${kind}">
      <h3 class="mark_name">${i + 1}. <span class="colorShallow">(${kind})</span>${stem}</h3>
      <div class="stem_answer">${
        i < 10
          ? ["A", "B", "C", "D"]
              .map(
                (letter) =>
                  `<div class="answerBg"><span class="${optionClass}" data="${letter}">${letter}</span><div class="answer_p"><p>选项${letter}</p></div></div>`,
              )
              .join("")
          : `<div class="edui-toolbar">字体 清除格式</div><textarea id="answer${id}"></textarea>`
      }</div>
      ${i < 10 ? `<input id="answer${id}" value="">` : ""}
    </div>`;
    })
    .join("")}</form><button id="submit">提交</button>`;
  for (const option of document.querySelectorAll(".answerBg")) {
    option.addEventListener("click", () => {
      const question = option.closest(".questionLi");
      const label = option.querySelector("span");
      const multi = question.getAttribute("typename") === "多选题";
      const selected = multi ? "check_answer_dx" : "check_answer";
      const alreadySelected = label.classList.contains(selected);
      if (!multi)
        question
          .querySelectorAll("span")
          .forEach((node) => node.classList.remove(selected));
      label.classList.toggle(selected, !alreadySelected);
      question.querySelector("input").value = Array.from(
        question.querySelectorAll(`.${selected}`),
        (node) => node.getAttribute("data"),
      ).join("");
    });
  }
  /** @type {HTMLElement} */ (document.querySelector(".answerBg span")).click();
}
/** @param {{start?: boolean, editorReady?: boolean, solveError?: string, backend?: boolean, answers?: {index: string, content: string}[]}} options */
async function setup(options = {}) {
  fixture();
  const nativeConfirm = vi.fn(() => true);
  const confirm = vi.fn(async () => options.start ?? true);
  const saveWork = vi.fn();
  const editor = { isReady: options.editorReady ?? true, setContent: vi.fn() };
  const invoke = vi.fn().mockImplementation(async (command) => {
    if (command === "options") return { switchingCd: null };
    if (command === "confirm") return confirm();
    if (command === "solve_questions") {
      if (options.solveError) throw new Error(options.solveError);
      return (
        options.answers ??
        stems
          .map((_, i) => ({
            index: String(i + 1),
            content: i < 8 ? "B" : i < 10 ? "AC" : "新时代的重大意义。",
          }))
          .reverse()
      );
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  const submit = vi.fn();
  document.querySelector("#submit").addEventListener("click", submit);
  vi.resetModules();
  vi.stubGlobal(
    "__TAURI_INTERNALS__",
    options.backend === false ? undefined : { invoke },
  );
  vi.stubGlobal("UE", { getEditor: vi.fn(() => editor) });
  vi.stubGlobal("saveWork", saveWork);
  vi.spyOn(window, "confirm").mockImplementation(nativeConfirm);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { main } = await import("@injected/chaoxing/work.js");
  const run = main();
  return { run, invoke, confirm, nativeConfirm, saveWork, editor, submit };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("homework takeover", () => {
  it("prompts and exits without a backend", async () => {
    const page = await setup({ backend: false });
    await page.run;
    expect(page.nativeConfirm).toHaveBeenCalledWith(
      "未检测到后端，无法自动答题。",
    );
    expect(page.invoke).not.toHaveBeenCalled();
    expect(page.saveWork).not.toHaveBeenCalled();
    expect(
      /** @type {HTMLInputElement} */ (
        document.querySelector("#answer406063260")
      ).value,
    ).toBe("A");
  });
  it("stops when fill authorization is cancelled", async () => {
    const page = await setup({ start: false });
    await flushPromises();
    const panel = document.querySelector("#uxs-manual-review");
    expect(panel).not.toBeNull();
    panel.querySelector("button").click();
    await page.run;
    expect(page.invoke.mock.calls.map(([command]) => command)).toEqual([
      "confirm",
    ]);
    expect(page.saveWork).not.toHaveBeenCalled();
  });
  it("extracts 11 questions, matches answers by displayed number, and waits for successful saving before the end confirmation", async () => {
    const page = await setup();
    await flushPromises();
    const call = page.invoke.mock.calls.find(
      ([command]) => command === "solve_questions",
    );
    const { questions, font } = call[1].payload;
    expect(font).toBeNull();
    expect(questions).toHaveLength(11);
    expect(questions[0]).toEqual({
      id: "1",
      kind: "单选题",
      stem: stems[0],
      options: ["A 选项A", "B 选项B", "C 选项C", "D 选项D"],
    });
    expect(questions[10]).toEqual({
      id: "11",
      kind: "简答题",
      stem: stems[10],
      options: [],
    });
    expect(
      /** @type {HTMLInputElement} */ (
        document.querySelector("#answer406063260")
      ).value,
    ).toBe("B");
    expect(
      /** @type {HTMLInputElement} */ (
        document.querySelector("#answer406063268")
      ).value,
    ).toBe("AC");
    expect(page.editor.setContent).toHaveBeenCalledWith("新时代的重大意义。");
    expect(page.saveWork).toHaveBeenCalledOnce();
    expect(page.confirm).toHaveBeenCalledTimes(2);
    expect(page.saveWork.mock.calls[0][0].silentSuccess).toBe(true);
    page.saveWork.mock.calls[0][0].success();
    await page.run;
    expect(page.invoke).toHaveBeenLastCalledWith("confirm", {
      message: "答案已填写并暂存，请自行提交。",
    });
    expect(page.submit).not.toHaveBeenCalled();
  });
  it("waits for UEditor readiness", async () => {
    vi.useFakeTimers();
    const page = await setup({ editorReady: false });
    await flushPromises();
    expect(page.saveWork).not.toHaveBeenCalled();
    page.editor.isReady = true;
    await vi.advanceTimersByTimeAsync(250);
    expect(page.saveWork).toHaveBeenCalledOnce();
    page.saveWork.mock.calls[0][0].success();
    await page.run;
  });
  it("reports a failed save without claiming success or submitting", async () => {
    const page = await setup();
    await flushPromises();
    page.saveWork.mock.calls[0][0].failure({ msg: "保存失败，请稍后重试" });
    await page.run;
    expect(page.invoke).toHaveBeenLastCalledWith("confirm", {
      message: "作业处理失败：保存失败，请稍后重试",
    });
    expect(page.submit).not.toHaveBeenCalled();
  });
  it.each([
    { solveError: "模型不可用" },
    { answers: [] },
    { answers: stems.map(() => ({ index: "1", content: "A" })) },
    {
      answers: stems.map((_, i) => ({
        index: String(i + 1),
        content: "Z",
      })),
    },
  ])(
    "does not save or submit when solving or applying answers fails: %j",
    async (options) => {
      const page = await setup(options);
      await page.run;
      expect(page.confirm).toHaveBeenCalledTimes(2);
      expect(page.saveWork).not.toHaveBeenCalled();
      expect(page.submit).not.toHaveBeenCalled();
    },
  );
});

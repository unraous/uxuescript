import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { SELECTORS } from "@injected/chaoxing/selectors.js";

const blanks = ["B", "H", "C", "E", "D", "G", "I", "F", "J", "A"];
const translation =
  "Community libraries are an important part of urban public cultural services.";

/** @param {string} [completion] @param {{title: string}|null} [metadata] */
async function setup(
  completion = blanks.join(";"),
  metadata = { title: "外刊精读" },
) {
  const doc = new DOMParser().parseFromString(
    gunzipSync(
      readFileSync("src-tauri/tests/assets/course-page/webpage3.html.gz"),
    ).toString("utf8"),
    "text/html",
  );
  // 真实 DOM 仅作为结构样本；页面脚本及内联事件均不执行。
  for (const script of doc.querySelectorAll("script")) script.remove();
  for (const element of doc.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      if (name.startsWith("on")) element.removeAttribute(name);
    }
  }
  vi.spyOn(doc, "defaultView", "get").mockReturnValue(window);
  const editors = new Map(
    Array.from(doc.querySelectorAll("textarea"), (node) => [
      node.id,
      {
        isReady: true,
        focus: vi.fn(),
        setContent: vi.fn(),
      },
    ]),
  );
  vi.stubGlobal("UE", {
    getEditor: (/** @type {string} */ id) => editors.get(id),
  });
  const choices = vi.fn();
  for (const node of doc.querySelectorAll(".reading_answer .hoverDiv")) {
    node.addEventListener("click", () =>
      choices(
        node.closest(".reading_answer"),
        node.querySelector("span[data]").getAttribute("data"),
      ),
    );
  }
  const answers = [
    { index: "1", content: completion, explanation: "" },
    ...[2, 3].flatMap((parent) =>
      Array.from({ length: 5 }, (_, i) => ({
        index: `${parent}.${i + 1}`,
        content: i % 2 ? "A" : "B",
        explanation: "",
      })),
    ),
    { index: "4", content: translation, explanation: "" },
  ].reverse();
  const invoke = vi.fn().mockImplementation(async (command) => {
    if (command === "query_course_meta") return metadata;
    if (command === "solve_questions") return answers;
    throw new Error(`Unexpected command: ${command}`);
  });
  vi.resetModules();
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
  const { answerPage } = await import("@injected/chaoxing/questions/page.js");
  const { config, studyContext } =
    await import("@injected/chaoxing/runtime.js");
  config.switchingCd = null;
  studyContext.chapter = "城市与自然";
  return { doc, editors, choices, invoke, answerPage };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Folio solve and fill", () => {
  it("sends the archived Folio with context, then fills ten editors, scoped choices and translation by id", async () => {
    const page = await setup();
    expect(await page.answerPage(page.doc, SELECTORS.workExam)).toEqual([]);
    const payload = page.invoke.mock.calls.find(
      ([command]) => command === "solve_questions",
    )[1].payload;
    const expected = JSON.parse(
      readFileSync("src-tauri/tests/assets/course-page/folio.json", "utf8"),
    );
    expect(payload).toEqual({
      ...expected,
      context: {
        course: "外刊精读",
        chapter: "城市与自然",
        title: "2026-2027-1 外刊精读 期中测试",
      },
    });
    const textareas = page.doc.querySelectorAll("#question405782771 textarea");
    for (const [index, node] of Array.from(textareas).entries()) {
      expect(
        page.editors.get(node.id).setContent,
      ).toHaveBeenCalledExactlyOnceWith(blanks[index]);
    }
    expect(
      page.editors.get("answer405782774").setContent,
    ).toHaveBeenCalledExactlyOnceWith(translation);
    expect(page.choices).toHaveBeenCalledTimes(10);
    for (const [index, node] of Array.from(
      page.doc.querySelectorAll(".reading_answer"),
    ).entries()) {
      expect(page.choices.mock.calls[index]).toEqual([
        node,
        (index % 5) % 2 ? "A" : "B",
      ]);
    }
  });

  it.each([
    blanks.slice(0, 9).join(";"),
    [...blanks, "B"].join(";"),
    [...blanks.slice(0, 9), " "].join(";"),
  ])(
    "rejects an invalid ten-blank answer before any writes: %s",
    async (answer) => {
      const page = await setup(answer);
      await expect(
        page.answerPage(page.doc, SELECTORS.workExam),
      ).rejects.toThrow("需要 10 个非空答案");
      for (const editor of page.editors.values())
        expect(editor.setContent).not.toHaveBeenCalled();
      expect(page.choices).not.toHaveBeenCalled();
    },
  );

  it("omits missing metadata and still solves when the course cache has no entry", async () => {
    const page = await setup(undefined, null);
    const { studyContext } = await import("@injected/chaoxing/runtime.js");
    delete studyContext.chapter;
    page.doc.querySelector(".mark_title").remove();
    await page.answerPage(page.doc, SELECTORS.workExam);
    const payload = page.invoke.mock.calls.find(
      ([command]) => command === "solve_questions",
    )[1].payload;
    expect(payload.context).toEqual({});
  });
});

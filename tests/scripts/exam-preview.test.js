import { afterEach, describe, expect, it, vi } from "vitest";
import html from "../fixtures/chaoxing/exam-preview.html?raw";
import { parseFolio, questions } from "@injected/chaoxing/questions/folio.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";

/** @param {import("@injected/chaoxing/questions/folio.js").Entry} entry */
function section(entry) {
  if (entry.type !== "section") throw new Error("Expected a section");
  return entry.data;
}

const parse = () => new DOMParser().parseFromString(html, "text/html");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("exam preview DOM", () => {
  it("stops at answer forms and keeps shared options in separate materials", () => {
    const doc = parse();
    const original = doc.body.innerHTML;
    const { folio, anchors } = parseFolio(doc, SELECTORS.examPreview);
    const leaves = questions(folio.entries);
    expect(doc.body.innerHTML).toBe(original);
    expect(folio.entries).toHaveLength(4);
    expect([...anchors.keys()]).toEqual([
      "1",
      "16.1",
      "16.2",
      "16.3",
      "17.1",
      "17.2",
      "18",
      "33",
    ]);
    expect(leaves[0]).toMatchObject({
      stem: "呼吸链的解偶联剂",
      options: ["B 寡霉素", "A 鱼滕酮", "D 2,4-二硝基苯酚", "C 氰化钾"],
    });
    const groups = section(folio.entries[1]).entries.map(section);
    expect(groups[0].passage).toEqual({
      text: "有关酶的分类\n共用备选答案：\nA EC1\nB EC2\nC EC3\nD EC4",
      images: [],
    });
    expect(groups[1].passage.text).toBe(
      "有关细胞代谢的区域化分布\n共用备选答案：\nA 细胞膜\nB 细胞浆\nC 线粒体内膜\nD 线粒体基质",
    );
    expect(
      leaves
        .slice(1, 6)
        .map(({ id, kind, stem, options }) => ({ id, kind, stem, options })),
    ).toEqual(
      [
        ["16.1", "乳酸脱氢酶属于"],
        ["16.2", "乙酰CoA羧化酶属于"],
        ["16.3", "α-淀粉酶属于"],
        ["17.1", "ATP合酶"],
        ["17.2", "EMP途径"],
      ].map(([id, stem]) => ({
        id,
        kind: "单选题",
        stem,
        options: ["A", "B", "C", "D"],
      })),
    );
    expect(leaves.at(-1)).toMatchObject({
      id: "33",
      kind: "分录题",
      blank_count: 5,
      stem: "tRNA二级结构模型的名称是什么?指出下图中各部分名称。 [图片1]",
      images: [
        {
          marker: "图片1",
          url: "https://p.ananas.chaoxing.com/star3/origin/878d690b3bfc8daa25c5e44ef1b54669.png",
        },
      ],
    });
    expect(JSON.stringify(folio)).not.toMatch(/标记|保存|清除格式|第1空/);
  });

  it("owns common option images on the material rather than each child", () => {
    const doc = parse();
    doc.querySelector("#sigleQuestionDiv_882379319 .p_wid805").innerHTML =
      '<p>选项图<img src="https://p.ananas.chaoxing.com/shared.png"></p>';
    const { folio } = parseFolio(doc, SELECTORS.examPreview);
    const group = section(section(folio.entries[1]).entries[0]);
    expect(group.passage.text).toContain("A 选项图 [图片1]");
    expect(group.passage.images).toEqual([
      { marker: "图片1", url: "https://p.ananas.chaoxing.com/shared.png" },
    ]);
    expect(
      questions(group.entries).every(
        (question) => question.images.length === 0,
      ),
    ).toBe(true);
    expect(
      section(section(folio.entries[1]).entries[1]).passage.images,
    ).toEqual([]);
  });
});

/** @param {string} [entryAnswer] @param {boolean} [failSave] @param {boolean} [deferFocus] */
async function setup(
  entryAnswer = "第一空;第二空;第三空;第四空;第五空",
  failSave = false,
  deferFocus = false,
) {
  const doc = parse();
  // 论述题只构造单编辑器场景；不将此正文冒充原卷题干。
  const essay = doc.createElement("div");
  essay.className = "questionLi singleQuesId";
  essay.innerHTML = `<h3 class="mark_name">43. <span class="colorShallow">(论述题)</span><div>论述题正文</div></h3>
    <form><div class="stem_answer"><div class="sub_que_div"><textarea id="essay"></textarea><a class="saveButtonClass" style="display:none">保存</a></div></div></form>`;
  doc.querySelector(".marking_content").append(essay);
  vi.spyOn(doc, "defaultView", "get").mockReturnValue(window);
  /** @type {string[]} */
  const operations = [];
  let pending = "";
  const editors = new Map(
    Array.from(doc.querySelectorAll("textarea"), (node) => [
      node.id,
      {
        isReady: true,
        focus: vi.fn(() => operations.push(`focus:${node.id}`)),
        body: {
          focus: vi.fn(() => {
            const showButton = () => {
              if (pending && pending !== node.id) return;
              pending = node.id;
              const button = /** @type {HTMLElement} */ (
                node.closest(".sub_que_div").querySelector(".saveButtonClass")
              );
              button.style.display = "";
            };
            if (deferFocus) window.setTimeout(showButton, 0);
            else showButton();
          }),
        },
        setContent: vi.fn(() => {
          operations.push(`write:${node.id}`);
        }),
      },
    ]),
  );
  doc.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement} */ (event.target);
    if (!button.matches(".saveButtonClass")) return;
    const id = button.closest(".sub_que_div").querySelector("textarea").id;
    operations.push(`save:${id}`);
    if (failSave) return;
    window.setTimeout(() => {
      button.style.display = "none";
      pending = "";
      operations.push(`saved:${id}`);
    }, 0);
  });
  vi.stubGlobal("UE", {
    getEditor: (/** @type {string} */ id) => editors.get(id),
  });
  // 模拟选项切换，断言真实选择器点击了哪个控件；不模拟平台网络保存。
  doc.addEventListener("click", (event) => {
    const option = /** @type {Element} */ (event.target);
    if (!option.matches("span[data], span[choice_name]")) return;
    const multiple = option.classList.contains("num_option_dx");
    const selected = multiple ? "check_answer_dx" : "check_answer";
    const wasSelected = option.classList.contains(selected);
    if (!multiple) {
      const scope = option.closest(".B-answerCon, .stem_answer");
      for (const previous of scope.querySelectorAll(`.${selected}`))
        previous.classList.remove(selected);
    }
    option.classList.toggle(selected, !wasSelected);
  });
  doc
    .querySelector('[index="1"] [choice_name="B"]')
    .classList.add("check_answer");
  const answers = [
    ["1", "D"],
    ["16.1", "B"],
    ["16.2", "A"],
    ["16.3", "D"],
    ["17.1", "C"],
    ["17.2", "B"],
    ["18", "ACE"],
    ["33", entryAnswer],
    ["43", "第一段论述。\n第二段论述。"],
  ]
    .reverse()
    .map(([index, content]) => ({
      index,
      content,
      explanation: "测试回填，不代表标准答案",
    }));
  const invoke = vi.fn().mockImplementation(async (command) => {
    if (command === "solve_questions") return answers;
    throw new Error(`Unexpected command: ${command}`);
  });
  vi.resetModules();
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
  const { answerPage } = await import("@injected/chaoxing/questions/page.js");
  return { doc, editors, invoke, answerPage, operations };
}

it("solves new types and fills scoped shared choices, shuffled options, five blanks and an essay", async () => {
  const { doc, editors, invoke, answerPage, operations } = await setup();
  expect(await answerPage(doc, SELECTORS.examPreview)).toEqual([]);
  const payload = invoke.mock.calls[0][1].payload;
  expect(payload.context).toEqual({ title: "2022-2023生物化学" });
  expect(questions(payload.entries).at(-1)).toMatchObject({
    kind: "论述题",
    stem: "论述题正文",
  });
  expect(
    Array.from(doc.querySelectorAll(".B-answerCon .check_answer"), (node) => [
      node.closest(".questionLi").getAttribute("data"),
      node.parentElement.getAttribute("index"),
      node.getAttribute("choice_name"),
    ]),
  ).toEqual([
    ["882379319", "1", "B"],
    ["882379319", "2", "A"],
    ["882379319", "3", "D"],
    ["882379320", "1", "C"],
    ["882379320", "2", "B"],
  ]);
  expect(
    doc.querySelector("#sigleQuestionDiv_882379283 .check_answer").textContent,
  ).toBe("C");
  expect(
    Array.from(
      doc.querySelectorAll(".check_answer_dx"),
      (node) => node.textContent,
    ),
  ).toEqual(["A", "B", "E"]);
  for (const [index, text] of [
    "第一空",
    "第二空",
    "第三空",
    "第四空",
    "第五空",
  ].entries()) {
    const editor = editors.get(`answerEditor882379308${index + 1}`);
    expect(editor.focus).toHaveBeenCalledOnce();
    expect(editor.focus).toHaveBeenCalledBefore(editor.setContent);
    expect(editor.setContent).toHaveBeenCalledExactlyOnceWith(text);
    if (index > 0) {
      const previous = editors.get(`answerEditor882379308${index}`);
      expect(previous.setContent).toHaveBeenCalledBefore(editor.focus);
    }
  }
  expect(editors.get("essay").setContent).toHaveBeenCalledExactlyOnceWith(
    "第一段论述。\n第二段论述。",
  );
  expect(operations).toEqual(
    [
      ...Array.from({ length: 5 }, (_, i) => `answerEditor882379308${i + 1}`),
      "essay",
    ].flatMap((id) => [
      `focus:${id}`,
      `write:${id}`,
      `save:${id}`,
      `saved:${id}`,
    ]),
  );
});

it("rejects a short entry answer before writing any editor", async () => {
  const { doc, editors, answerPage } =
    await setup("第一空;第二空;第三空;第四空");
  await expect(answerPage(doc, SELECTORS.examPreview)).rejects.toThrow(
    "需要 5 个非空答案",
  );
  for (const editor of editors.values())
    expect(editor.setContent).not.toHaveBeenCalled();
});

it("stops before the next blank if the current save does not complete", async () => {
  const { doc, editors, answerPage } = await setup(undefined, true);
  const { wait } = await import("@injected/utils/async.js");
  vi.spyOn(wait, "until").mockImplementation(
    async (getter) => (await getter()) || null,
  );
  await expect(answerPage(doc, SELECTORS.examPreview)).rejects.toThrow(
    "答案暂存超时",
  );
  expect(
    editors.get("answerEditor8823793081").setContent,
  ).toHaveBeenCalledOnce();
  expect(editors.get("answerEditor8823793082").focus).not.toHaveBeenCalled();
});

it("waits for an existing save to unlock before clicking the next save button", async () => {
  const { doc, editors, answerPage } = await setup();
  const essay = editors.get("essay");
  essay.setContent.mockImplementationOnce(() => {
    vi.stubGlobal("submitOnce", true);
    window.setTimeout(() => vi.stubGlobal("submitOnce", false), 0);
  });
  const lockedAtClick = vi.fn();
  doc.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement} */ (event.target);
    if (button.closest(".questionLi")?.querySelector("#essay")) {
      lockedAtClick(
        /** @type {Window & {submitOnce?: boolean}} */ (window).submitOnce,
      );
    }
  });
  await answerPage(doc, SELECTORS.examPreview);
  expect(lockedAtClick).toHaveBeenCalledExactlyOnceWith(false);
});

it("waits for the body focus handler to show the save button", async () => {
  const { doc, editors, answerPage } = await setup(undefined, false, true);
  await answerPage(doc, SELECTORS.examPreview);
  expect(
    editors.get("answerEditor8823793081").body.focus,
  ).toHaveBeenCalledOnce();
  expect(
    editors.get("answerEditor8823793085").setContent,
  ).toHaveBeenCalledOnce();
});

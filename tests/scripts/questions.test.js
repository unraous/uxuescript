import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import matchingHtml from "../fixtures/chaoxing/exam-matching.html?raw";
import singleHtml from "../fixtures/chaoxing/exam-single.html?raw";
import { extractQuestion } from "@injected/chaoxing/questions/extract.js";
import { parseFolio, questions } from "@injected/chaoxing/questions/folio.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
import { fillAnswer } from "@injected/chaoxing/questions/fill.js";
import { fillMatching } from "@injected/chaoxing/questions/matching.js";

const matchingAnswer = "1:G;2:A;3:B;4:D;5:F;6:I;7:C;8:E;9:H";

/** @param {string} html */
function load(html) {
  document.body.innerHTML = html;
  return document.querySelector(".questionLi.singleQuesId");
}

/** @param {Element} node */
function recordChoices(node) {
  /** @type {string[][]} */
  const clicks = [];
  node.addEventListener("click", (event) => {
    const option = /** @type {Element} */ (event.target).closest(
      ".options li[data] a",
    );
    if (!option) return;
    event.preventDefault();
    clicks.push([
      option.closest(".line_answer_ct").getAttribute("index"),
      option.parentElement.getAttribute("data"),
      option.textContent.trim(),
    ]);
  });
  return clicks;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe.each([
  ["work/exam", SELECTORS.workExam],
  ["quiz", SELECTORS.quiz],
])("shared filling on %s", (_name, selectors) => {
  /**
   * @param {boolean} multiple
   * @param {string[]} values
   * @param {string[]} selectedValues
   * @param {string} kind
   */
  function choices(multiple, values, selectedValues, kind) {
    const node = document.createElement("div");
    node.innerHTML = `<span class="colorShallow newZy_TItle">${kind}</span><div class="stem_answer">${values
      .map(
        (value) =>
          `<span class="${multiple ? "num_option_dx" : "num_option"} ${selectedValues.includes(value) ? (multiple ? "check_answer_dx" : "check_answer") : ""}" data="${value}"></span>`,
      )
      .join("")}</div>`;
    document.body.append(node);
    node.addEventListener("click", (event) => {
      const option = /** @type {Element} */ (event.target).closest(
        "span[data]",
      );
      if (!option) return;
      option.classList.toggle(multiple ? "check_answer_dx" : "check_answer");
    });
    return node;
  }

  it("clears and reapplies an already selected single answer", async () => {
    const node = choices(false, ["A", "B"], ["A"], "单选题");
    await fillAnswer(node, "A", selectors);
    expect(
      Array.from(
        node.querySelectorAll(selectors.clearSelectedClass),
        (option) => option.getAttribute("data"),
      ),
    ).toEqual(["A"]);
  });

  it("replaces old multiple choices, including an option retained in the answer", async () => {
    const node = choices(true, ["A", "B", "C"], ["A", "B"], "多选题");
    await fillAnswer(node, "AC", selectors);
    expect(
      Array.from(
        node.querySelectorAll(selectors.clearSelectedClass),
        (option) => option.getAttribute("data"),
      ),
    ).toEqual(["A", "C"]);
  });

  it("maps judgment A to the first option even when its data is false", async () => {
    const node = choices(false, ["false", "true"], ["true"], "判断题");
    await fillAnswer(node, "A", selectors);
    expect(
      Array.from(
        node.querySelectorAll(selectors.clearSelectedClass),
        (option) => option.getAttribute("data"),
      ),
    ).toEqual(["false"]);
  });

  it.each(["填空题", "简答题"])(
    "writes %s through the textarea's own iframe window",
    async (kind) => {
      const topGetEditor = vi.fn();
      vi.stubGlobal("UE", { getEditor: topGetEditor });
      const frame = document.createElement("iframe");
      document.body.append(frame);
      const frameDoc = frame.contentDocument;
      const firstEditor = {
        isReady: true,
        focus: vi.fn(),
        setContent: vi.fn(),
      };
      const secondEditor = {
        isReady: true,
        focus: vi.fn(),
        setContent: vi.fn(),
      };
      const getEditor = vi.fn((id) =>
        id === "answer1" ? firstEditor : secondEditor,
      );
      Object.defineProperty(frame.contentWindow, "UE", {
        value: { getEditor },
      });
      frameDoc.body.innerHTML = `<div id="question">
      <span class="colorShallow newZy_TItle">${kind}</span>
      <div class="stem_answer"><textarea id="answer1"></textarea>
      ${kind === "填空题" ? '<textarea id="answer2"></textarea>' : ""}</div>
    </div>`;

      await fillAnswer(
        frameDoc.getElementById("question"),
        " 第一段;第二段 ",
        selectors,
      );

      expect(topGetEditor).not.toHaveBeenCalled();
      expect(getEditor).toHaveBeenNthCalledWith(1, "answer1");
      expect(firstEditor.focus).toHaveBeenCalledOnce();
      expect(firstEditor.focus).toHaveBeenCalledBefore(firstEditor.setContent);
      if (kind === "填空题") {
        expect(getEditor).toHaveBeenNthCalledWith(2, "answer2");
        expect(secondEditor.focus).toHaveBeenCalledOnce();
        expect(firstEditor.setContent).toHaveBeenCalledBefore(
          secondEditor.focus,
        );
        expect(secondEditor.focus).toHaveBeenCalledBefore(
          secondEditor.setContent,
        );
        expect(firstEditor.setContent).toHaveBeenCalledExactlyOnceWith(
          "第一段",
        );
        expect(secondEditor.setContent).toHaveBeenCalledExactlyOnceWith(
          "第二段",
        );
      } else {
        expect(getEditor).toHaveBeenCalledOnce();
        expect(firstEditor.setContent).toHaveBeenCalledExactlyOnceWith(
          "第一段;第二段",
        );
        expect(secondEditor.setContent).not.toHaveBeenCalled();
        expect(secondEditor.focus).not.toHaveBeenCalled();
      }
    },
  );
});

describe("user-provided Chaoxing exam HTML", () => {
  it("returns the same payload shape without a font for the real exam page", () => {
    const node = load(singleHtml);
    const { folio } = parseFolio(document, SELECTORS.workExam);
    expect(questions(folio.entries)).toEqual([
      extractQuestion(node, SELECTORS.workExam),
    ]);
    expect(folio.font).toBeNull();
  });

  it("uses selector configuration to extract the archived quiz questions and exact font bytes", () => {
    const directory = "src-tauri/tests/assets/course-page";
    const html = gunzipSync(
      readFileSync(`${directory}/webpage.html.gz`),
    ).toString("utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const { folio: payload } = parseFolio(doc, SELECTORS.quiz);
    const expected = JSON.parse(
      readFileSync(`${directory}/questions.json`, "utf8"),
    );
    for (const question of expected) {
      question.kind = question.kind.replace(/[【】]/g, "");
      question.images = [];
    }
    expect(questions(payload.entries)).toEqual(expected);
    expect(payload.font).toEqual(
      Array.from(readFileSync(`${directory}/cxs-font.ttf`)),
    );
  });

  it("extracts the real single-choice question whose container is outside the form", () => {
    const node = load(singleHtml);
    expect(document.querySelector("#submitTest").contains(node)).toBe(false);
    expect(extractQuestion(node, SELECTORS.workExam)).toEqual({
      id: "1",
      kind: "单选题",
      stem: "（尤指苦战后获得的）胜利，成功，成就",
      options: ["A triumph", "B community"],
      images: [],
    });
  });

  it("decodes embedded LaTeX and keeps bitmap positions in the question", () => {
    const node = document.createElement("div");
    node.className = "questionLi singleQuesId";
    node.innerHTML = `
      <h3 class="mark_name">1. <span class="colorShallow">(单选题)</span>
        设<img class="ans-latex-moudle" data="%22f%28x%29%3Dx%5E2%22" src="https://p.cldisk.com/formula.png">，则
      </h3>
      <div class="stem_answer">
        <div class="answerBg"><span data="A"></span><div class="answer_p"><img src="https://p.cldisk.com/a.png"></div></div>
        <div class="answerBg"><span data="B"></span><div class="answer_p">普通文本</div></div>
      </div>`;
    document.body.append(node);

    expect(extractQuestion(node, SELECTORS.workExam)).toEqual({
      id: "1",
      kind: "单选题",
      stem: "设 [公式: f(x)=x^2] ，则",
      options: ["A [图片1]", "B 普通文本"],
      images: [{ marker: "图片1", url: "https://p.cldisk.com/a.png" }],
    });
  });

  it("extracts both matching groups using displayed labels and leaves the page title intact", () => {
    const node = load(matchingHtml);
    const originalTitle = node.querySelector(".mark_name").innerHTML;
    expect(extractQuestion(node, SELECTORS.workExam)).toEqual({
      id: "32",
      kind: "连线题",
      stem: "Match",
      options: [
        "第1组 1 收获益处",
        "第1组 2 有可能成功；有机会获得",
        "第1组 3 给......以机会；给......敞开方便之门",
        "第1组 4 竭尽所能",
        "第1组 5 预先，提前",
        "第1组 6 以.....为乐",
        "第1组 7 使......想起",
        "第1组 8 过活；过得去；勉强应付",
        "第1组 9 逐渐地；慢慢地",
        "第2组 A stand a chance (of doing sth. )",
        "第2组 B open the door to sth.",
        "第2组 C remind sb. of sb./sth.",
        "第2组 D attain your best",
        "第2组 E get by (on/with)",
        "第2组 F in advance",
        "第2组 G reap the benefits",
        "第2组 H over time",
        "第2组 I take delight in doing sth.",
      ],
      images: [],
    });
    expect(node.querySelector(".mark_name").innerHTML).toBe(originalTitle);
  });

  it("clicks all nine actual matching options, mapping displayed 1→G to internal 4→A", async () => {
    const node = load(matchingHtml);
    const clicks = recordChoices(node);
    const question = extractQuestion(node, SELECTORS.workExam);
    fillMatching(node, question.options, matchingAnswer);
    expect(clicks).toEqual([
      ["4", "A", "G"],
      ["6", "C", "A"],
      ["9", "F", "B"],
      ["3", "E", "D"],
      ["5", "I", "F"],
      ["8", "H", "I"],
      ["1", "B", "C"],
      ["2", "D", "E"],
      ["7", "G", "H"],
    ]);
  });

  it("keeps the original pairings when both groups and dropdown display order change", async () => {
    const node = load(matchingHtml);
    const question = extractQuestion(node, SELECTORS.workExam);
    for (const side of ["fl", "fr"]) {
      const group = node.querySelector(`.line_wid_half.${side}`);
      group.append(group.querySelector(".lineCt"));
      for (const [index, item] of Array.from(
        group.querySelectorAll(".lineCt"),
      ).entries()) {
        item.querySelector("span[data]").textContent =
          `${side === "fl" ? index + 1 : String.fromCharCode(65 + index)}.`;
      }
    }
    const list = node.querySelector('.line_answer_ct[index="4"] .options');
    list.prepend(list.querySelector('li[data="A"]'));
    for (const [index, item] of Array.from(list.children).entries()) {
      item.querySelector("a").textContent = String.fromCharCode(65 + index);
    }
    const clicks = recordChoices(node);
    fillMatching(node, question.options, matchingAnswer);
    expect(clicks[0]).toEqual(["4", "A", "A"]);
    expect(clicks).toHaveLength(9);
  });
});

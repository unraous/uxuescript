import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseFolio } from "@injected/chaoxing/questions/folio.js";
import {
  extractQuestion,
  extractFont,
} from "@injected/chaoxing/questions/extract.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
import singleHtml from "../fixtures/chaoxing/exam-single.html?raw";
import matchingHtml from "../fixtures/chaoxing/exam-matching.html?raw";

const directory = "src-tauri/tests/assets/course-page";

/** @param {string} name */
function archive(name) {
  return new DOMParser().parseFromString(
    gunzipSync(readFileSync(`${directory}/${name}.html.gz`)).toString("utf8"),
    "text/html",
  );
}

/** @param {import("@injected/chaoxing/questions/folio.js").Entry} entry */
function section(entry) {
  if (entry.type !== "section") throw new Error("Expected a section");
  return entry.data;
}

/** @param {import("@injected/chaoxing/questions/folio.js").Entry} entry */
function question(entry) {
  if (entry.type !== "question") throw new Error("Expected a question");
  return entry.data;
}

describe("Folio DOM parsing", () => {
  it("parses the complete archived homework into the shared Rust fixture without changing the DOM", () => {
    const doc = archive("webpage3");
    const original = doc.body.innerHTML;
    const { folio, anchors } = parseFolio(doc, SELECTORS.workExam);
    const expected = JSON.parse(
      readFileSync(`${directory}/folio.json`, "utf8"),
    );

    expect(folio).toEqual(expected);
    expect(doc.body.innerHTML).toBe(original);
    expect([...anchors.keys()]).toEqual([
      "1",
      "2.1",
      "2.2",
      "2.3",
      "2.4",
      "2.5",
      "3.1",
      "3.2",
      "3.3",
      "3.4",
      "3.5",
      "4",
    ]);
    expect(JSON.stringify(folio)).not.toContain('"anchors"');
    expect(
      parseFolio(doc.querySelector("#submitForm"), SELECTORS.workExam).folio,
    ).toEqual(folio);
  });

  it("anchors ten blanks and the translation to their editors", () => {
    const { anchors } = parseFolio(archive("webpage3"), SELECTORS.workExam);
    expect(
      anchors
        .get("1")
        .node.querySelectorAll(anchors.get("1").selectors.textInputs),
    ).toHaveLength(10);
    expect(
      anchors
        .get("4")
        .node.querySelectorAll(anchors.get("4").selectors.textInputs),
    ).toHaveLength(1);
  });

  it("scopes reading choices to the correct child", () => {
    const doc = archive("webpage3");
    const { folio, anchors } = parseFolio(doc, SELECTORS.workExam);
    const reading = section(folio.entries[1]);
    const first = section(reading.entries[0]);
    const second = section(reading.entries[1]);
    for (const entry of [...first.entries, ...second.entries]) {
      const item = question(entry);
      const anchor = anchors.get(item.id);
      expect(anchor.node.matches(".reading_answer")).toBe(true);
      expect(
        anchor.node.querySelectorAll(anchor.selectors.choice.single),
      ).toHaveLength(4);
    }
    expect(anchors.get("2.1").node).toBe(
      doc.querySelector("#question405782772 .reading_answer"),
    );
    expect(anchors.get("3.1").node).toBe(
      doc.querySelector("#question405782773 .reading_answer"),
    );
  });

  it.each(["webpage", "webpage2"])(
    "preserves the archived chapter questions and font in %s",
    (name) => {
      const doc = archive(name);
      const expected = Array.from(
        doc.querySelectorAll(SELECTORS.quiz.question),
        (node) => extractQuestion(node, SELECTORS.quiz),
      );
      const { folio, anchors } = parseFolio(doc, SELECTORS.quiz);
      expect(folio.entries.map(question)).toMatchObject(expected);
      expect(folio.font).toEqual(extractFont(doc));
      expect(anchors.size).toBe(expected.length);
    },
  );

  it("keeps independent exam questions under their section, including a heading inside the first question", () => {
    const doc = new DOMParser().parseFromString(
      singleHtml + matchingHtml,
      "text/html",
    );
    const first = doc.querySelector(SELECTORS.workExam.question);
    const next = /** @type {Element} */ (first.cloneNode(true));
    next.querySelector(".type_tit").remove();
    next.querySelector(".mark_name").firstChild.textContent = "2. ";
    first.after(next);
    const { folio, anchors } = parseFolio(doc, SELECTORS.workExam);
    const singles = section(folio.entries[0]);
    const matching = section(folio.entries[1]);
    expect(folio.entries).toHaveLength(2);
    expect(singles.passage).toBeNull();
    expect(matching.passage).toBeNull();
    expect(singles.entries.map((entry) => question(entry).id)).toEqual([
      "1",
      "2",
    ]);
    expect(question(singles.entries[0]).stem).toBe(
      "（尤指苦战后获得的）胜利，成功，成就",
    );
    expect(question(matching.entries[0])).toMatchObject({
      id: "32",
      kind: "连线题",
      stem: "Match",
    });
    expect(question(matching.entries[0]).options).toHaveLength(18);
    expect(anchors.get("1").node).toBe(first);
    expect(anchors.get("2").node).toBe(next);
  });

  it("keeps passage and child images separate and preserves formula metadata", () => {
    const doc = archive("webpage3");
    const parent = doc.querySelector("#question405782772");
    const picture = doc.createElement("p");
    picture.innerHTML =
      '材料图<img src="https://p.cldisk.com/passage.png"><img class="ans-latex-moudle" data="%22x%5E2%22" src="https://p.cldisk.com/formula.png">';
    parent.querySelector(":scope > .clear").before(picture);
    const answer = parent.querySelector(".reading_answer .answer_p");
    answer.innerHTML = '选项图<img src="https://p.cldisk.com/choice.png">';

    const { folio } = parseFolio(doc, SELECTORS.workExam);
    const reading = section(section(folio.entries[1]).entries[0]);
    expect(reading.passage.text).toContain("材料图 [图片1] [公式: x^2]");
    expect(reading.passage.images).toEqual([
      { marker: "图片1", url: "https://p.cldisk.com/passage.png" },
    ]);
    const first = question(reading.entries[0]);
    expect(first.options[0]).toBe("A 选项图 [图片1]");
    expect(first.images).toEqual([
      { marker: "图片1", url: "https://p.cldisk.com/choice.png" },
    ]);
    expect(question(reading.entries[1]).images).toEqual([]);
    expect(picture.querySelectorAll("img")).toHaveLength(2);
    expect(answer.querySelectorAll("img")).toHaveLength(1);
  });
});

import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "@injected/chaoxing/runtime.js";
import { wait } from "@injected/utils/async.js";
import { handleTab } from "@injected/chaoxing/course/chapter/tasks.js";
import { handleVideo } from "@injected/chaoxing/course/chapter/tasks/video.js";
import { handleAudio } from "@injected/chaoxing/course/chapter/tasks/audio.js";
import { handlePDF } from "@injected/chaoxing/course/chapter/tasks/pdf.js";
import { handleQuiz } from "@injected/chaoxing/course/chapter/tasks/quiz.js";

vi.mock("@injected/chaoxing/course/chapter/tasks/video.js", () => ({
  handleVideo: vi.fn(),
}));
vi.mock("@injected/chaoxing/course/chapter/tasks/audio.js", () => ({
  handleAudio: vi.fn(),
}));
vi.mock("@injected/chaoxing/course/chapter/tasks/pdf.js", () => ({
  handlePDF: vi.fn(),
}));
vi.mock("@injected/chaoxing/course/chapter/tasks/quiz.js", () => ({
  handleQuiz: vi.fn(),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
/** @param {typeof config.debugTaskTypes} debugTypes */
function setup(debugTypes, hasBackend = true) {
  const handlers = {
    Video: handleVideo,
    Audio: handleAudio,
    PDF: handlePDF,
    Quiz: handleQuiz,
  };
  for (const handler of Object.values(handlers))
    vi.mocked(handler).mockReset().mockResolvedValue(undefined);
  Object.assign(config, {
    debugTaskTypes: debugTypes,
    hasBackend,
    switchingCd: null,
    lockSpeed: null,
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(wait, "elements").mockImplementation(
    async (_action, selector, root) =>
      Array.from(root.querySelectorAll(selector)),
  );
  vi.spyOn(wait, "element").mockImplementation(
    async (_action, selector, root) => root.querySelector(selector),
  );
  vi.spyOn(wait, "until").mockImplementation(async (getter) => getter());
  const autoComplete = { value: true };
  const originalObserve = MutationObserver.prototype.observe;
  const observe = vi
    .spyOn(MutationObserver.prototype, "observe")
    .mockImplementation(function (target, options) {
      originalObserve.call(this, target, options);
      if (autoComplete.value)
        queueMicrotask(() =>
          /** @type {Element} */ (target).classList.add("ans-job-finished"),
        );
    });
  const chapter = document.implementation.createHTMLDocument();
  /**
   * @param {string} kind
   * @param {boolean} marked
   */
  const add = (kind, marked, finished = false) => {
    const container = document.createElement("div");
    container.className = `ans-attach-ct${finished ? " ans-job-finished" : ""}`;
    if (marked)
      container.appendChild(document.createElement("span")).className =
        "ans-job-icon";
    const iframe = document.createElement("iframe");
    Object.defineProperty(iframe, "contentDocument", {
      value: {
        location: {
          href: `https://example.com/ananas/modules/${kind}/index.html`,
        },
        body: { children: [{}] },
      },
    });
    container.appendChild(iframe);
    chapter.body.appendChild(container);
    return container;
  };
  return {
    handlers,
    wait,
    observe,
    autoComplete,
    chapter,
    add,
    error,
    run: () => handleTab(chapter),
  };
}
describe("audio task dispatch", () => {
  it("runs standalone audio and waits for its task completion marker", async () => {
    const page = setup([], false);
    page.add("audio", true);
    await page.run();
    expect(page.handlers.Audio).toHaveBeenCalledOnce();
    expect(page.observe).toHaveBeenCalledOnce();
  });
  it("skips completed audio tasks", async () => {
    const page = setup([], false);
    page.add("audio", true, true);
    await page.run();
    expect(page.handlers.Audio).not.toHaveBeenCalled();
    expect(page.observe).not.toHaveBeenCalled();
  });
  it("selects audio in debug mode without waiting for completion", async () => {
    const page = setup(["Audio"], false);
    page.add("audio", false, true);
    page.add("video", true);
    await page.run();
    expect(page.handlers.Audio).toHaveBeenCalledOnce();
    expect(page.handlers.Video).not.toHaveBeenCalled();
    expect(page.observe).not.toHaveBeenCalled();
  });
});
describe("watch duration tasks", () => {
  it("disables speed locking for the task and subsequent tasks", async () => {
    const page = setup([]);
    config.lockSpeed = 2;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const task = page.add("video", true);
    task.querySelector(".ans-job-icon").innerHTML =
      '<span class="task-condition">观看时长需 ≥ 总时长的 90%</span>';
    page.add("video", true);
    vi.mocked(page.handlers.Video).mockImplementation(async () => {
      expect(config.lockSpeed).toBeNull();
    });

    await page.run();

    expect(page.handlers.Video).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("有观看时长要求，关闭后续倍速锁定"),
    );
    expect(config.lockSpeed).toBeNull();
  });

  it("recognizes the requirement on a completed task before skipping it", async () => {
    const page = setup([]);
    config.lockSpeed = 2;
    const task = page.add("video", true, true);
    task.querySelector(".ans-job-icon").innerHTML =
      '<span class="task-condition">观看时长需 ≥ 总时长的 90%</span>';
    page.add("video", true);

    await page.run();

    expect(page.handlers.Video).toHaveBeenCalledOnce();
    expect(config.lockSpeed).toBeNull();
  });

  it("leaves speed locking unchanged for other task conditions", async () => {
    const page = setup([]);
    config.lockSpeed = 2;
    const task = page.add("video", true);
    task.querySelector(".ans-job-icon").innerHTML =
      '<span class="task-condition">其他要求</span>';

    await page.run();

    expect(config.lockSpeed).toBe(2);
  });
});
describe("debug task selection", () => {
  it("processes only selected types, including unmarked and completed attachments", async () => {
    const page = setup(["Quiz"]);
    page.add("video", true);
    page.add("pdf", true);
    page.add("work", false);
    page.add("work", true, true);
    page.add("unknown", false);
    const imageAttachment = page.chapter.body.appendChild(
      document.createElement("div"),
    );
    imageAttachment.className = "ans-attach-ct";
    await page.run();
    expect(page.handlers.Quiz).toHaveBeenCalledTimes(2);
    expect(page.handlers.Video).not.toHaveBeenCalled();
    expect(page.handlers.PDF).not.toHaveBeenCalled();
    expect(page.observe).not.toHaveBeenCalled();
    expect(page.wait.elements).toHaveBeenCalledWith(
      null,
      ".ans-attach-ct:has(iframe)",
      page.chapter,
      false,
    );
  });
  it("allows several selected types and skips Quiz without requiring a backend", async () => {
    const page = setup(["Video", "PDF"], false);
    page.add("work", true);
    page.add("video", false);
    page.add("pdf", false, true);
    await page.run();
    expect(page.handlers.Video).toHaveBeenCalledOnce();
    expect(page.handlers.PDF).toHaveBeenCalledOnce();
    expect(page.handlers.Quiz).not.toHaveBeenCalled();
    expect(page.observe).not.toHaveBeenCalled();
  });
  it("keeps normal mode limited to unfinished marked tasks", async () => {
    const page = setup([]);
    page.add("work", false);
    page.add("work", true, true);
    page.add("video", true);
    page.add("pdf", true);
    await page.run();
    expect(page.handlers.Quiz).not.toHaveBeenCalled();
    expect(page.handlers.Video).toHaveBeenCalledOnce();
    expect(page.handlers.PDF).toHaveBeenCalledOnce();
    expect(page.observe).toHaveBeenCalledTimes(2);
    expect(page.wait.elements).toHaveBeenCalledWith(
      null,
      ".ans-attach-ct:has(.ans-job-icon)",
      page.chapter,
      "",
    );
  });
  it("still waits for the task completion marker in normal mode", async () => {
    const page = setup([]);
    page.add("video", true);
    page.autoComplete.value = false;
    let done = false;
    const run = page.run().then(() => {
      done = true;
    });
    await flushPromises();
    expect(page.handlers.Video).toHaveBeenCalledOnce();
    expect(done).toBe(false);
    page.chapter.body.firstElementChild.classList.add("ans-job-finished");
    await run;
    expect(done).toBe(true);
  });
  it.each([
    ["unknown", "未识别的任务点类型:"],
    ["work", "未开启后端服务，无法处理Quiz任务点"],
  ])(
    "continues after a %s assertion without starting its completion watcher",
    async (kind, message) => {
      const page = setup([], false);
      page.add(kind, true);
      page.add("pdf", true);
      await page.run();
      expect(page.error).toHaveBeenCalledOnce();
      expect(page.error).toHaveBeenCalledWith(
        expect.stringContaining("第 1/2 个任务点 处理异常，自动跳过"),
        expect.objectContaining({ message: expect.stringContaining(message) }),
      );
      expect(page.handlers.Quiz).not.toHaveBeenCalled();
      expect(page.handlers.PDF).toHaveBeenCalledOnce();
      expect(page.observe).toHaveBeenCalledOnce();
      expect(page.observe).toHaveBeenCalledWith(page.chapter.body.children[1], {
        attributes: true,
        attributeFilter: ["class"],
      });
    },
  );
  it("does not fail on a debug page without frame attachments", async () => {
    const page = setup(["Quiz"]);
    await page.run();
    expect(page.handlers.Quiz).not.toHaveBeenCalled();
  });
});

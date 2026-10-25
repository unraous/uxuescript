import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCore } from "../support/core";

afterEach(() => vi.useRealTimers());

function setup(
  debugTypes: ReturnType<typeof loadCore>["config"]["debugTaskTypes"],
  hasBackend = true,
) {
  const handlers = {
    Video: vi.fn(async () => {}),
    Audio: vi.fn(async () => {}),
    PDF: vi.fn(async () => {}),
    Quiz: vi.fn(async () => {}),
  };
  const context = {
    window: { __TAURI_INTERNALS__: { invoke: vi.fn(async () => true) } },
    console: { info: vi.fn(), error: vi.fn() },
  };
  const { config, wait, handleTab } = loadCore(context, {
    handleVideo: handlers.Video,
    handleAudio: handlers.Audio,
    handlePDF: handlers.PDF,
    handleQuiz: handlers.Quiz,
  });
  config.debugTaskTypes = debugTypes;
  config.hasBackend = hasBackend;
  wait.elements = vi.fn<ReturnType<typeof loadCore>["wait"]["elements"]>(
    async (_action, selector, root) =>
      Array.from(root.querySelectorAll<HTMLElement>(selector)),
  );
  wait.element = vi.fn<ReturnType<typeof loadCore>["wait"]["element"]>(
    async (_action, selector, root) =>
      root.querySelector<HTMLElement>(selector)!,
  );
  wait.until = async (getter) => getter();
  const taskPointComplete = vi.fn<
    ReturnType<typeof loadCore>["wait"]["taskPointComplete"]
  >(async () => true);
  wait.taskPointComplete = taskPointComplete;
  const chapter = document.implementation.createHTMLDocument();
  const add = (kind: string, marked: boolean, finished = false) => {
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
  };
  return {
    handlers,
    wait: { ...wait, taskPointComplete },
    chapter,
    add,
    error: context.console.error,
    run: () => handleTab(chapter),
  };
}

describe("audio task dispatch", () => {
  it("runs standalone audio and waits for its task completion marker", async () => {
    const page = setup([], false);
    page.add("audio", true);
    await page.run();
    expect(page.handlers.Audio).toHaveBeenCalledOnce();
    expect(page.wait.taskPointComplete).toHaveBeenCalledOnce();
  });

  it("skips completed audio tasks", async () => {
    const page = setup([], false);
    page.add("audio", true, true);
    await page.run();
    expect(page.handlers.Audio).not.toHaveBeenCalled();
    expect(page.wait.taskPointComplete).not.toHaveBeenCalled();
  });

  it("selects audio in debug mode without waiting for completion", async () => {
    const page = setup(["Audio"], false);
    page.add("audio", false, true);
    page.add("video", true);
    await page.run();
    expect(page.handlers.Audio).toHaveBeenCalledOnce();
    expect(page.handlers.Video).not.toHaveBeenCalled();
    expect(page.wait.taskPointComplete).not.toHaveBeenCalled();
  });
});

describe("debug task selection", () => {
  it.each([true, false])(
    "only repeats blocked chapters in normal mode (debug %s)",
    async (debugging) => {
      vi.useFakeTimers();
      const scan = vi.fn(async () => {});
      const blockingCount = vi.fn().mockReturnValueOnce(1).mockReturnValue(0);
      const invoke = vi.fn(async (command: string) =>
        command === "options" ? {} : true,
      );
      const context = {
        window: {
          __TAURI_INTERNALS__: { invoke },
          setTimeout: window.setTimeout.bind(window),
        },
      };
      const api = loadCore(context, {
        handleCourse: scan,
        blockingCount,
        totalChapterList: () => [],
      });
      api.config.debugTaskTypes = debugging ? ["Quiz"] : [];
      const run = api.main();
      await flushPromises();
      expect(scan).toHaveBeenCalledOnce();
      if (debugging) {
        await run;
        expect(blockingCount).not.toHaveBeenCalled();
      } else {
        await vi.advanceTimersByTimeAsync(10000);
        await run;
        expect(scan).toHaveBeenCalledTimes(2);
      }
      expect(invoke).toHaveBeenCalledWith("send_status", {
        status: { kind: "finish", payload: null },
      });
    },
  );

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
    expect(page.wait.taskPointComplete).not.toHaveBeenCalled();
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
    expect(page.wait.taskPointComplete).not.toHaveBeenCalled();
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
    expect(page.wait.taskPointComplete).toHaveBeenCalledTimes(2);
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
    let finish!: (value: boolean) => void;
    page.wait.taskPointComplete.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    let done = false;
    const run = page.run().then(() => {
      done = true;
    });
    await flushPromises();
    expect(page.handlers.Video).toHaveBeenCalledOnce();
    expect(done).toBe(false);
    finish(true);
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
      expect(page.wait.taskPointComplete).toHaveBeenCalledOnce();
      expect(page.wait.taskPointComplete).toHaveBeenCalledWith(
        page.chapter.body.children[1],
      );
    },
  );

  it("does not fail on a debug page without frame attachments", async () => {
    const page = setup(["Quiz"]);
    await page.run();
    expect(page.handlers.Quiz).not.toHaveBeenCalled();
  });
});

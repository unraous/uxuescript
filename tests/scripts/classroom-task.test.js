import { flushPromises } from "@vue/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { config } from "@injected/chaoxing/runtime.js";
import { wait } from "@injected/utils/async.js";
import { handleTab } from "@injected/chaoxing/course/chapter/tasks.js";
import { invoke } from "@injected/utils/backend.js";

const backend = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  confirm: vi.fn(),
}));
vi.mock("@injected/utils/backend.js", () => backend);

afterEach(() => {
  vi.restoreAllMocks();
  backend.invoke.mockReset().mockResolvedValue(undefined);
});

function setup() {
  Object.assign(config, {
    debugTaskTypes: [],
    switchingCd: null,
    hasBackend: true,
  });
  const chapter = document.implementation.createHTMLDocument();
  const container = chapter.createElement("div");
  container.className = "ans-attach-ct";
  container.innerHTML = '<span class="ans-job-icon"></span><iframe></iframe>';
  chapter.body.append(container);
  const frame = container.querySelector("iframe");
  frame.src =
    "https://mooc1.chaoxing.com/ananas/modules/zt/classTask/index-pc.html";
  const link = document.createElement("a");
  link.href = "https://k.chaoxing.com/sg6356?enterType=chapterTask&ext=job";
  vi.spyOn(wait, "elements").mockResolvedValue([container]);
  vi.spyOn(wait, "element").mockImplementation(async (_action, selector) =>
    selector === "#classurl" ? link : frame,
  );
  const taskDoc = /** @type {Document} */ (
    /** @type {unknown} */ ({
      location: {
        href: "https://mooc1.chaoxing.com/ananas/modules/zt/classTask/index-pc.html",
      },
      defaultView: { frameElement: frame },
    })
  );
  vi.spyOn(wait, "iframeDoc").mockResolvedValue(taskDoc);
  return { chapter, container };
}

it("opens the platform classroom link in the course window", async () => {
  const { chapter, container } = setup();
  let finished = false;
  const run = handleTab(chapter).then(() => {
    finished = true;
  });
  await flushPromises();
  expect(invoke).toHaveBeenCalledWith("navigate_to_task", {
    url: "https://k.chaoxing.com/sg6356?enterType=chapterTask&ext=job",
  });
  expect(finished).toBe(false);
  container.classList.add("ans-job-finished");
  await run;
  expect(finished).toBe(true);
});

it("skips a classroom task when the backend is unavailable", async () => {
  const { chapter } = setup();
  config.hasBackend = false;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await handleTab(chapter);
  expect(error).toHaveBeenCalledWith(
    expect.stringContaining("Classroom"),
    expect.objectContaining({
      message: "未开启后端服务，无法处理Classroom任务点",
    }),
  );
  expect(invoke).not.toHaveBeenCalledWith(
    "navigate_to_task",
    expect.anything(),
  );
});

it("waits for the platform marker after returning from the same classroom", async () => {
  const { chapter, container } = setup();
  backend.invoke.mockImplementation(async (command) =>
    command === "take_completed_task" ? true : undefined,
  );
  let finished = false;
  const run = handleTab(chapter).then(() => {
    finished = true;
  });
  await flushPromises();
  expect(invoke).not.toHaveBeenCalledWith(
    "navigate_to_task",
    expect.anything(),
  );
  expect(finished).toBe(false);
  container.classList.add("ans-job-finished");
  await run;
  expect(finished).toBe(true);
});

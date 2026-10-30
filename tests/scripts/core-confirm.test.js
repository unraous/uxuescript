import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@injected/chaoxing/focus.js", () => ({
  preserveFocusState: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** @param {(command: string, args?: unknown) => Promise<unknown>} [invoke] */
async function setup(invoke) {
  vi.resetModules();
  document.body.innerHTML = "";
  const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("__TAURI_INTERNALS__", invoke ? { invoke } : undefined);
  const { main } = await import("@injected/chaoxing/course.js");
  const timer = vi.spyOn(window, "setTimeout");
  return { run: main(), nativeConfirm, timer };
}

describe("course confirmation", () => {
  it("passes extended confirmation options to the backend", async () => {
    vi.resetModules();
    const invoke = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke });
    const { confirm } = await import("@injected/utils/backend.js");
    await expect(
      confirm("Read this", { title: "Notice", readSeconds: 2 }),
    ).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith("confirm", {
      message: "Read this",
      options: { title: "Notice", readSeconds: 2 },
    });
  });

  it("keeps native confirmation compatible when options are supplied", async () => {
    vi.resetModules();
    vi.stubGlobal("__TAURI_INTERNALS__", undefined);
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { confirm } = await import("@injected/utils/backend.js");
    expect(confirm("Read this", { title: "Notice", readSeconds: 2 })).toBe(
      true,
    );
    expect(nativeConfirm).toHaveBeenCalledExactlyOnceWith("Read this");
  });

  it("uses native confirmation without replacing the page function", async () => {
    const page = await setup();
    await page.run;
    expect(page.nativeConfirm).toHaveBeenCalledOnce();
    expect(page.nativeConfirm).toHaveBeenCalledWith(
      expect.stringContaining("独立脚本不能处理章节测验"),
    );
    expect(window.confirm).toBe(page.nativeConfirm);
  });

  it("uses native confirmations for both course start and completion", async () => {
    vi.resetModules();
    vi.stubGlobal("__TAURI_INTERNALS__", undefined);
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { main } = await import("@injected/chaoxing/course.js");
    await main();
    expect(nativeConfirm).toHaveBeenCalledTimes(2);
    expect(nativeConfirm).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("独立脚本不能处理章节测验"),
    );
    expect(nativeConfirm.mock.calls[0][0]).not.toContain("模型设置");
    expect(nativeConfirm).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("课程处理流程已完成"),
    );
  });

  it("waits for the backend decision before reporting cancellation", async () => {
    /** @type {(value: boolean) => void} */
    let choose;
    const invoke = vi.fn(async (command) => {
      if (command === "options") return {};
      if (command === "confirm")
        return new Promise((resolve) => {
          choose = resolve;
        });
    });
    const page = await setup(invoke);
    await flushPromises();
    expect(page.nativeConfirm).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith("send_status", expect.anything());
    choose(false);
    await page.run;
    expect(invoke).toHaveBeenCalledWith("send_status", {
      status: { kind: "cancel", payload: null },
    });
  });

  it("does not start when the backend confirmation is cancelled", async () => {
    const invoke = vi.fn(async (command) =>
      command === "options" ? {} : false,
    );
    const page = await setup(invoke);
    await page.run;
    expect(invoke).not.toHaveBeenCalledWith("send_status", {
      status: { kind: "start", payload: null },
    });
  });

  it("runs the course once and reports completion without a polling delay", async () => {
    const invoke = vi
      .fn()
      .mockImplementation(async (command) =>
        command === "options" ? {} : true,
      );
    const page = await setup(invoke);
    await page.run;
    const states = invoke.mock.calls
      .filter(([command]) => command === "send_status")
      .map(([, args]) => args.status.kind);
    expect(states).toEqual(["start", "finish"]);
    const confirmations = invoke.mock.calls
      .filter(([command]) => command === "confirm")
      .map(([, args]) => args);
    expect(confirmations).toHaveLength(2);
    expect(confirmations[0]).toMatchObject({
      message: expect.stringContaining("大量题目显示未作答"),
      options: { title: "课程开始", readSeconds: 5 },
    });
    expect(confirmations[0].message).toContain("人工核验 / Review Answers");
    expect(confirmations[0].message).toContain("测试连接");
    expect(confirmations[1]).toMatchObject({
      message: expect.stringContaining("模型答案可能有误，请人工核对"),
      options: { title: "课程处理已完成", readSeconds: 5 },
    });
    expect(page.timer).not.toHaveBeenCalled();
  });
});

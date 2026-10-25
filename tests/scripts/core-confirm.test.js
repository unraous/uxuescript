import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  it("uses native confirmation without replacing the page function", async () => {
    const page = await setup();
    await page.run;
    expect(page.nativeConfirm).toHaveBeenCalledOnce();
    expect(window.confirm).toBe(page.nativeConfirm);
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
    expect(page.timer).not.toHaveBeenCalled();
  });
});

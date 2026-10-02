import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import initScript from "../src-tauri/src/scripts/iframe-init.js?raw";
import coreScript from "../src-tauri/src/scripts/core.js?raw";

function createPage() {
  const nativeConfirm = vi.fn(() => false);
  const pageWindow = {
    confirm: nativeConfirm as (message?: string) => boolean | Promise<boolean>,
    __TAURI_INTERNALS__: undefined as { invoke: ReturnType<typeof vi.fn> } | undefined,
    EventTarget: class { addEventListener() {} },
    addEventListener: vi.fn(),
    location: { href: "https://mooc1.chaoxing.com/mycourse/" },
    top: null as unknown,
  };
  pageWindow.top = pageWindow;
  const context = {
    window: pageWindow,
    document: { addEventListener: vi.fn() },
    console: { info: vi.fn(), error: vi.fn() },
  };
  Object.defineProperty(context, "confirm", { get: () => pageWindow.confirm });
  runInNewContext(initScript, context);
  return { context, pageWindow, nativeConfirm };
}

describe("course confirmation", () => {
  it("uses the native confirmation without a backend", async () => {
    const { context, pageWindow, nativeConfirm } = createPage();
    runInNewContext(coreScript, context);
    await flushPromises();
    expect(nativeConfirm).toHaveBeenCalledOnce();
    expect(context.console.info).toHaveBeenCalledWith("用户已取消脚本运行");
    expect(pageWindow.confirm).toBe(nativeConfirm);
  });

  it("waits for the backend decision without overriding the page confirmation", async () => {
    const { context, pageWindow, nativeConfirm } = createPage();
    let choose!: (value: boolean) => void;
    const invoke = vi.fn(async (command: string) => {
      if (command === "options") return {};
      if (command === "confirm")
        return new Promise<boolean>((resolve) => { choose = resolve; });
      return null;
    });
    pageWindow.__TAURI_INTERNALS__ = { invoke };

    runInNewContext(coreScript, context);
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith("confirm", { message: expect.stringContaining("是否确认开始运行？") });
    expect(invoke).not.toHaveBeenCalledWith("send_status", expect.anything());
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(pageWindow.confirm).toBe(nativeConfirm);
    choose(false);
    await flushPromises();
    expect(invoke).toHaveBeenCalledWith("send_status", { status: { kind: "cancel", payload: null } });
  });

  it("stops the course startup when the backend confirmation is cancelled", async () => {
    const { context, pageWindow } = createPage();
    let cancelled!: () => void;
    const cancellation = new Promise<void>((resolve) => { cancelled = resolve; });
    const invoke = vi.fn(async (command: string, args?: { status?: { kind: string } }) => {
      if (command === "options") return {};
      if (command === "confirm") return false;
      if (command === "send_status" && args?.status?.kind === "cancel") cancelled();
      return null;
    });
    pageWindow.__TAURI_INTERNALS__ = { invoke };
    runInNewContext(coreScript, context);
    await cancellation;

    expect(invoke.mock.calls.some(([command, args]) =>
      command === "send_status" && args?.status?.kind === "start",
    )).toBe(false);
    expect(invoke).not.toHaveBeenCalledWith("platform");
  });
});

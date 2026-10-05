import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showError } from "@/services/errors";

const commandMocks = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("@/services/cmds", () => ({ commands: commandMocks }));

beforeEach(() => {
  commandMocks.confirm.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("showError", () => {
  it("logs the original error and shows its message in the confirmation", async () => {
    const cause = new Error("permission denied");
    await showError("保存失败:", cause);

    expect(console.error).toHaveBeenCalledWith("保存失败:", cause);
    expect(commandMocks.confirm).toHaveBeenCalledWith("保存失败:\npermission denied");
  });

  it("waits for the current confirmation before showing the next error", async () => {
    let closeFirst!: (choice: boolean) => void;
    commandMocks.confirm.mockImplementationOnce(() =>
      new Promise<boolean>((resolve) => { closeFirst = resolve; }),
    );

    const first = showError("第一个错误", "first");
    const second = showError("第二个错误", "second");
    await Promise.resolve();
    expect(commandMocks.confirm).toHaveBeenCalledTimes(1);

    closeFirst(false);
    await Promise.all([first, second]);
    expect(commandMocks.confirm).toHaveBeenNthCalledWith(2, "第二个错误\nsecond");
  });

  it("logs a failed confirmation and continues showing subsequent errors", async () => {
    const cause = new Error("confirmation IPC failed");
    commandMocks.confirm.mockRejectedValueOnce(cause);

    await showError("保存失败", "save failed");
    await showError("导航失败", "navigation failed");

    expect(console.error).toHaveBeenCalledWith("显示错误弹窗失败:", cause);
    expect(commandMocks.confirm).toHaveBeenCalledTimes(2);
    expect(commandMocks.confirm).toHaveBeenLastCalledWith("导航失败\nnavigation failed");
  });
});

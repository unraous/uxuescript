import type { commands } from "@/services/cmds";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showError } from "@/services/errors";
import { z } from "zod";
import {
  nonZeroU32,
  optionalPositiveNumber,
} from "@/composables/useConfig/schemas";

const commandMocks = vi.hoisted(() => ({
  confirm: vi.fn<typeof commands.confirm>(),
}));
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
    expect(commandMocks.confirm).toHaveBeenCalledWith(
      "保存失败:\npermission denied",
      null,
    );
  });

  it.each(["", "0", "1.5", "4294967296", "abc"])(
    "explains positive integers for %j without displaying Zod metadata",
    async (input) => {
      const result = nonZeroU32.safeParse(input);
      if (result.success) throw new Error("Expected validation to fail");

      await showError("通用配置操作失败:", result.error);

      expect(commandMocks.confirm).toHaveBeenCalledWith(
        "通用配置操作失败:\n请输入大于 0 的整数。",
        null,
      );
      expect(console.error).toHaveBeenCalledWith(
        "通用配置操作失败:",
        result.error,
      );
    },
  );

  it.each(["0", ".", "Infinity"])(
    "explains positive numbers and the empty option for %j",
    async (input) => {
      const result = optionalPositiveNumber.safeParse(input);
      if (result.success) throw new Error("Expected validation to fail");

      await showError("课程配置操作失败:", result.error);

      expect(commandMocks.confirm).toHaveBeenCalledWith(
        "课程配置操作失败:\n请输入大于 0 的数字，或留空关闭。",
        null,
      );
    },
  );

  it("shows distinct validation instructions once each", async () => {
    const result = z
      .object({
        concurrency: nonZeroU32,
        batchSize: nonZeroU32,
        lockSpeed: optionalPositiveNumber,
      })
      .safeParse({ concurrency: "0", batchSize: "0", lockSpeed: "." });
    if (result.success) throw new Error("Expected validation to fail");

    await showError("配置无效:", result.error);

    expect(commandMocks.confirm).toHaveBeenCalledWith(
      "配置无效:\n请输入大于 0 的整数。\n请输入大于 0 的数字，或留空关闭。",
      null,
    );
  });

  it("waits for the current confirmation before showing the next error", async () => {
    let closeFirst!: (choice: boolean) => void;
    commandMocks.confirm.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          closeFirst = resolve;
        }),
    );

    const first = showError("第一个错误", "first");
    const second = showError("第二个错误", "second");
    await Promise.resolve();
    expect(commandMocks.confirm).toHaveBeenCalledTimes(1);

    closeFirst(false);
    await Promise.all([first, second]);
    expect(commandMocks.confirm).toHaveBeenNthCalledWith(
      2,
      "第二个错误\nsecond",
      null,
    );
  });

  it("logs a failed confirmation and continues showing subsequent errors", async () => {
    const cause = new Error("confirmation IPC failed");
    commandMocks.confirm.mockRejectedValueOnce(cause);

    await showError("保存失败", "save failed");
    await showError("导航失败", "navigation failed");

    expect(console.error).toHaveBeenCalledWith("显示错误弹窗失败:", cause);
    expect(commandMocks.confirm).toHaveBeenCalledTimes(2);
    expect(commandMocks.confirm).toHaveBeenLastCalledWith(
      "导航失败\nnavigation failed",
      null,
    );
  });
});

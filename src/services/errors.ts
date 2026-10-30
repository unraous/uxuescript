import { commands } from "./cmds";
import { ZodError } from "zod";

let pending = Promise.resolve();

function errorDetail(cause: unknown): string {
  if (cause instanceof ZodError) {
    return [...new Set(cause.issues.map((issue) => issue.message))].join("\n");
  }
  return cause instanceof Error ? cause.message : String(cause);
}

export const showError = (message: string, cause: unknown): Promise<void> => {
  console.error(message, cause);
  const detail = errorDetail(cause);

  // 多个命令可能同时失败；后端会拒绝重叠的确认请求，因此逐个展示。
  pending = pending.then(async () => {
    try {
      await commands.confirm(`${message}\n${detail}`, null);
    } catch (error) {
      // 确认 IPC 本身失败时只记录日志，避免递归弹窗。
      console.error("显示错误弹窗失败:", error);
    }
  });
  return pending;
};

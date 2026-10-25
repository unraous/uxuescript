import { config } from "@injected/chaoxing/runtime.js";
import { invoke, confirm } from "@injected/utils/backend.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
import { AutomationStopped } from "@injected/chaoxing/safety.js";
import { chapterNodeStatus } from "./chapters.js";

/**
 * @param {import("../../../src/services/cmds").CourseStatus} status
 */
const invokeStatus = async (status) => {
  try {
    if (invoke) {
      await invoke("send_status", { status });
    }
  } catch (e) {
    console.error("[send_status] 发送进度状态失败:", e);
  }
};

/** 向桌面端报告进度；普通浏览器中不发送 IPC。 */
export const emit = {
  started: async () => {
    await invokeStatus({ kind: "start", payload: null });
  },

  /** @type {(index: number, node: Element, list: Element[]) => Promise<void>} */
  chapterProgress: async (index, node, list) => {
    const title =
      node.querySelector(SELECTORS.courseTree.nameClass)?.textContent?.trim() ||
      node.textContent?.trim() ||
      `章节 ${index + 1}`;
    const total = list.length;
    const completed = list.filter(
      (node) => chapterNodeStatus(node) === "Finished",
    ).length;
    await invokeStatus({
      kind: "chapter",
      payload: { title, index, completed, total },
    });
  },

  /** @type {(index: number, total: number) => Promise<void>} */
  tabProgress: async (index, total) => {
    await invokeStatus({ kind: "tab", payload: { index, total } });
  },

  /** @type {(index: number, category: string) => Promise<void>} */
  taskProgress: async (index, category) => {
    await invokeStatus({ kind: "task", payload: { index, category } });
  },

  cancelled: async () => {
    await invokeStatus({ kind: "cancel", payload: null });
  },

  finished: async () => {
    await invokeStatus({ kind: "finish", payload: null });
  },
};

/**
 * 记录操作错误；普通模式跳过，调试模式由用户选择继续或终止。
 * @param {() => Promise<unknown>} action 要执行的操作。
 * @param {string} errorMessage 操作失败时的业务说明。
 * @returns {Promise<void>}
 */
export const safeRun = async (action, errorMessage) => {
  try {
    await action();
  } catch (e) {
    if (e instanceof AutomationStopped) throw e;
    console.error(errorMessage, e);
    if (config.debugTaskTypes.length) {
      const msg = `[DEBUG 异常]\n提示: ${errorMessage}\n详情: ${e instanceof Error ? e.message : String(e)}\n\n确定：忽略并继续；取消：终止。`;
      if (!(await confirm(msg))) throw e;
    }
  }
};

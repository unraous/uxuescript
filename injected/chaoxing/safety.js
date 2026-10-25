/**
 * 任务安全策略、提交门禁和暂停/停止控制。
 *
 * This module intentionally has no project imports so it can be unit-tested
 * without a browser or the Tauri backend.
 */

export class AutomationStopped extends Error {}
export class ManualReviewRequired extends AutomationStopped {}
export class TaskStopped extends AutomationStopped {}

export const TaskState = Object.freeze({
  IDLE: "IDLE",
  RUNNING: "RUNNING",
  PAUSING: "PAUSING",
  PAUSED: "PAUSED",
  STOPPING: "STOPPING",
  STOPPED: "STOPPED",
  FAILED: "FAILED",
});

/** 页面内可见的任务控制条：暂停、恢复、停止。 */
export const controller = {
  /** @type {"IDLE"|"RUNNING"|"PAUSING"|"PAUSED"|"STOPPING"|"STOPPED"|"FAILED"} */
  state: TaskState.IDLE,
  /** @type {{pause: () => void, play: () => void} | null} */
  media: null,
  /** @type {HTMLDivElement | null} */
  panel: null,
  /** @type {HTMLSpanElement | null} */
  status: null,
  /** @type {HTMLButtonElement | null} */
  pauseButton: null,
  /** @type {HTMLButtonElement | null} */
  resumeButton: null,
  /** @type {HTMLButtonElement | null} */
  stopButton: null,

  /** @param {typeof TaskState[keyof typeof TaskState]} next */
  setState(next) {
    this.state = next;
    console.info(`任务状态：${next}`);
    this.render();
  },

  /** @param {{pause: () => void, play: () => void} | null} media */
  setMedia(media) {
    this.media = media ?? null;
  },

  async checkpoint() {
    while (this.state === TaskState.PAUSED) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (
      this.state === TaskState.STOPPING ||
      this.state === TaskState.STOPPED
    ) {
      throw new TaskStopped("任务已停止");
    }
  },

  pause() {
    if (this.state !== TaskState.RUNNING) return;
    this.setState(TaskState.PAUSING);
    try {
      this.media?.pause();
    } catch (error) {
      console.warn("暂停媒体失败", error);
    }
    this.setState(TaskState.PAUSED);
  },

  resume() {
    if (this.state !== TaskState.PAUSED) return;
    this.setState(TaskState.RUNNING);
    try {
      this.media?.play();
    } catch (error) {
      console.warn("恢复媒体失败", error);
    }
  },

  stop() {
    if (
      this.state === TaskState.STOPPING ||
      this.state === TaskState.STOPPED
    ) {
      return;
    }
    this.setState(TaskState.STOPPING);
    try {
      this.media?.pause();
    } catch (error) {
      console.warn("停止媒体失败", error);
    }
    this.setState(TaskState.STOPPED);
  },

  start() {
    this.setState(TaskState.RUNNING);
    this.attachPanel();
  },

  finish() {
    if (this.state !== TaskState.STOPPED) {
      this.setState(TaskState.STOPPED);
    }
  },

  render() {
    if (!this.status) return;
    this.status.textContent = `状态：${this.state}`;
    if (this.pauseButton)
      this.pauseButton.disabled = this.state !== TaskState.RUNNING;
    if (this.resumeButton)
      this.resumeButton.disabled = this.state !== TaskState.PAUSED;
    if (this.stopButton) {
      this.stopButton.disabled =
        this.state === TaskState.IDLE ||
        this.state === TaskState.STOPPING ||
        this.state === TaskState.STOPPED;
    }
  },

  attachPanel() {
    if (
      this.panel ||
      typeof document === "undefined" ||
      !document.body
    ) {
      return;
    }
    const panel = document.createElement("div");
    panel.id = "uxs-task-control";
    panel.style.cssText =
      "position:fixed;left:16px;bottom:16px;z-index:2147483646;display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #1d4ed8;border-radius:8px;background:#fff;color:#111827;font:13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.22);";
    const status = document.createElement("span");
    status.textContent = `状态：${this.state}`;
    /** @param {string} text @param {() => void} handler */
    const make = (text, handler) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.style.cssText =
        "border:1px solid #1d4ed8;border-radius:5px;background:#fff;color:#1d4ed8;padding:3px 8px;cursor:pointer;";
      button.addEventListener("click", handler);
      panel.appendChild(button);
      return button;
    };
    panel.appendChild(status);
    this.pauseButton = make("暂停", () => this.pause());
    this.resumeButton = make("恢复", () => this.resume());
    this.stopButton = make("停止", () => this.stop());
    this.status = status;
    document.body.appendChild(panel);
    this.panel = panel;
    this.render();
  },
};

/**
 * 任务类型只能用于日志/调度，不能单独授予填写或提交权限。
 * @param {"Video"|"Audio"|"PDF"|"Quiz"|"Other"|string} type
 * @returns {"LEARNING"|"NEEDS_CONFIRMATION"|"RESTRICTED"}
 */
export const classifyTaskPolicy = (type) => {
  if (type === "Video" || type === "Audio" || type === "PDF") return "LEARNING";
  if (type === "Quiz") return "NEEDS_CONFIRMATION";
  return "RESTRICTED";
};

/** @param {Document|null|undefined} taskDoc */
const pageText = (taskDoc) =>
  String(taskDoc?.body?.innerText ?? "").slice(0, 50_000);

/** @param {Document|null|undefined} taskDoc */
export const isRestrictedPage = (taskDoc) =>
  /(禁止自动化|禁止ai|restricted)/i.test(pageText(taskDoc));

/** @param {Document|null|undefined} taskDoc */
export const isGradedPage = (taskDoc) => {
  const text = pageText(taskDoc);
  // 正式考试信号优先于“非计分”措辞，避免矛盾页面被放行。
  if (/(正式考试|考试|graded|exam)/i.test(text)) return true;
  if (/计分/i.test(text) && !/(非计分|不计分|未计分|ungraded)/i.test(text)) {
    return true;
  }
  return false;
};

/**
 * @typedef {{kind: "GRADED"|"PRACTICE"|"UNGRADED"|"NEEDS_CONFIRMATION"|"RESTRICTED", allowFill: boolean, allowSubmit: boolean, reason: string}} TaskPolicy
 */

/**
 * @param {Document|null|undefined} taskDoc
 * @param {string} label
 * @param {(message: string) => boolean | Promise<boolean>} confirmFn
 * @returns {Promise<TaskPolicy>}
 */
export const resolveQuizPolicy = async (taskDoc, label, confirmFn) => {
  if (isRestrictedPage(taskDoc)) {
    const policy = {
      kind: "RESTRICTED",
      allowFill: false,
      allowSubmit: false,
      reason: "页面明确限制自动化",
    };
    console.info(`任务策略：${label}`, policy);
    return policy;
  }
  if (isGradedPage(taskDoc)) {
    const policy = {
      kind: "GRADED",
      allowFill: false,
      allowSubmit: false,
      reason: "页面出现正式考试/计分信号",
    };
    console.info(`任务策略：${label}`, policy);
    return policy;
  }

  const allowFill = await confirmFn(
    `检测到${label}。\n\n默认只显示参考答案，不自动填写、不自动提交。\n\n只有当你确认这是明确允许自动化的非计分练习时，才选择 Yes 允许自动填写。`,
  );
  if (!allowFill) {
    const policy = {
      kind: "NEEDS_CONFIRMATION",
      allowFill: false,
      allowSubmit: false,
      reason: "用户未授权自动填写",
    };
    console.info(`任务策略：${label}`, policy);
    return policy;
  }

  const allowSubmit = await confirmFn(
    `是否允许自动提交？\n\n仅当你确认此任务明确允许自动化、且不是正式考试或计分测验时才选择 Yes。\n选择 No 将只填写答案，由你在平台原生界面手动提交。`,
  );
  const policy = {
    kind: allowSubmit ? "PRACTICE" : "UNGRADED",
    allowFill: true,
    allowSubmit,
    reason: allowSubmit ? "用户授权非计分练习自动提交" : "用户仅授权填写",
  };
  console.info(`任务策略：${label}`, policy);
  return policy;
};

/**
 * 只申请“允许填写”，不申请提交；供作业等非测验写入路径使用。
 * @param {Document|null|undefined} taskDoc
 * @param {string} label
 * @param {(message: string) => boolean | Promise<boolean>} confirmFn
 * @returns {Promise<TaskPolicy>}
 */
export const resolveFillPolicy = async (taskDoc, label, confirmFn) => {
  if (isRestrictedPage(taskDoc) || isGradedPage(taskDoc)) {
    const policy = {
      kind: isRestrictedPage(taskDoc) ? "RESTRICTED" : "GRADED",
      allowFill: false,
      allowSubmit: false,
      reason: "页面限制或包含计分/考试信号",
    };
    console.info(`任务策略：${label}`, policy);
    return policy;
  }
  const allowFill = await confirmFn(
    `检测到${label}。\n\n默认不自动填写。只有当你确认这是明确允许自动化的非计分练习时，才选择 Yes 允许填写；本功能不会自动提交。`,
  );
  const policy = {
    kind: allowFill ? "UNGRADED" : "NEEDS_CONFIRMATION",
    allowFill,
    allowSubmit: false,
    reason: allowFill ? "用户仅授权填写" : "用户未授权自动填写",
  };
  console.info(`任务策略：${label}`, policy);
  return policy;
};

/** @param {TaskPolicy} policy */
export const assertSubmitAllowed = (policy) => {
  if (!policy?.allowSubmit) {
    throw new ManualReviewRequired("当前任务策略不允许自动提交");
  }
};

/** @param {{question?: string, answer?: string, explanation?: string}[]} items */
const formatReviewItems = (items) =>
  items
    .map(
      (item, index) =>
        `${index + 1}. ${item.question || `第 ${index + 1} 题`}\n答案：${item.answer || "未生成"}\n解析：${item.explanation || "未提供"}`,
    )
    .join("\n\n");

/**
 * 非模态人工处理面板。关闭面板会停止任务控制器，避免后台继续。
 * @param {string} title
 * @param {string} intro
 * @param {{question?: string, answer?: string, explanation?: string}[]} items
 * @returns {Promise<void>}
 */
export const showManualReviewPanel = (title, intro, items) =>
  new Promise((resolve) => {
    if (typeof document === "undefined" || !document.body) {
      resolve();
      return;
    }
    const panel = document.createElement("div");
    panel.id = "uxs-manual-review";
    panel.style.cssText =
      "position:fixed;right:16px;top:16px;z-index:2147483647;width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;padding:16px;border:2px solid #b45309;border-radius:8px;background:#fffbeb;color:#111827;font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.3);white-space:pre-wrap;";
    const heading = document.createElement("h3");
    heading.textContent = title;
    heading.style.margin = "0 0 8px";
    const body = document.createElement("div");
    body.textContent = `${intro}\n\n${formatReviewItems(items)}`.trim();
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "关闭并停止自动化";
    close.style.cssText =
      "margin-top:12px;padding:6px 10px;border:1px solid #b45309;border-radius:5px;background:#fff;color:#92400e;cursor:pointer;";
    close.addEventListener("click", () => {
      panel.remove();
      controller.stop();
      resolve();
    });
    panel.append(heading, body, close);
    document.body.appendChild(panel);
  });

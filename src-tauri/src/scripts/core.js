// @ts-check
(() => {
  "use strict";

  /** @type {<T = any>(cmd: string, args?: Record<string, any>) => Promise<T>} */
  let tauriInvoke = /** @type {any} */ (window).__TAURI_INTERNALS__?.invoke;

  // 只替换脚本内部的确认调用，保留第三方页面同步 window.confirm 的语义。
  /** @type {(message: string) => boolean | Promise<boolean>} */
  const confirm = tauriInvoke
    ? (message) => tauriInvoke("confirm", { message })
    : window.confirm.bind(window);

  /** SELECTORS 选择器及静态字符串统一配置表 */
  const SELECTORS = {
    courseTree: {
      nodeClass: "div.posCatalog_select",
      nameClass: "span.posCatalog_name",
      titleSelector: ":has(span.posCatalog_title)",
      unfinishedSelector: ":has(.orangeNew)",
    },
    chapter: { tabClass: "div.prev_white" },
    video: {
      tag: "video",
      launchBtnClass: ".vjs-big-play-button",
      timelineClass: ".ans-timelineobjects",
      quizClass: ".ans-videoquiz",
      quizItemClass: ".tkItem",
      quizTitleClass: ".tkItem_title",
      quizOptionClass: ".ans-videoquiz-opt",
      quizSubmitId: "#videoquiz-submit",
      quizContinueId: "#videoquiz-continue",
    },
    audio: {
      tag: "#audio audio.vjs-tech",
      launchBtnClass: "#audio .vjs-play-control",
    },
    pdf: { iframeId: "#panView" },
    quiz: {
      titleClass: ".newZy_TItle",
      clearSelectedClass: "span:is(.check_answer, .check_answer_dx)",
      blankItemDiv: ".blankItemDiv",
      ueditorIframe: 'iframe[id^="ueditor_"]',
      textarea: 'textarea[id^="answer"], textarea',
      frameContentId: "#frame_content",
      singleQuesClass: "div.singleQuesId",
      btnSubmitClass: "a.btnSubmit",
      reeditBtnClass: "a.jb_btn_bg[onclick*='reediter']",
      modalId: "#workpop",
      modalOkBtnId: "a#popok",
    },
    taskPoint: {
      finishedClass: "ans-job-finished",
      containerSelector: ".ans-attach-ct:has(.ans-job-icon)",
      attachmentSelector: ".ans-attach-ct:has(iframe)",
      iframeTag: "iframe",
    },
    frames: {
      blankUrl: "about:blank",
      chapterFrameId: "#iframe",
    },
    urls: {
      video: "/ananas/modules/video/",
      audio: "/ananas/modules/audio/",
      pdf: "/ananas/modules/pdf/",
      quiz: "/ananas/modules/work/",
    },
  };

  /** @type {(ms: number, fluctuationPercent?: number) => Promise<void>} */
  const sleep = (ms, fluctuationPercent = 0) =>
    new Promise((resolve) =>
      window.setTimeout(
        resolve,
        ms * (1 + ((Math.random() * 2 - 1) * fluctuationPercent) / 100),
      ),
    );

  /** @type {(cond: any, msg: string) => asserts cond} */
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  class AutomationStopped extends Error {}
  class ManualReviewRequired extends AutomationStopped {}
  class TaskStopped extends AutomationStopped {}

  const TaskState = Object.freeze({
    IDLE: "IDLE",
    RUNNING: "RUNNING",
    PAUSING: "PAUSING",
    PAUSED: "PAUSED",
    STOPPING: "STOPPING",
    STOPPED: "STOPPED",
    FAILED: "FAILED",
  });

  /** @typedef {"IDLE" | "RUNNING" | "PAUSING" | "PAUSED" | "STOPPING" | "STOPPED" | "FAILED"} TaskStateValue */

  /** 页面内可见的任务控制条：暂停、恢复、停止。 */
  const controller = {
    /** @type {TaskStateValue} */
    state: TaskState.IDLE,
    /** @type {{ pause: () => void, play: () => void } | null} */
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

    /** @param {TaskStateValue} next */
    setState(next) {
      this.state = next;
      console.info(`任务状态：${next}`);
      this.render();
    },

    /** @param {{ pause: () => void, play: () => void } | null} media */
    setMedia(media) {
      this.media = media ?? null;
    },

    async checkpoint() {
      while (this.state === TaskState.PAUSED) await sleep(250);
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
      if (this.pauseButton) this.pauseButton.disabled = this.state !== TaskState.RUNNING;
      if (this.resumeButton) this.resumeButton.disabled = this.state !== TaskState.PAUSED;
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
      /**
       * @param {string} text
       * @param {() => void} handler
       */
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

  /** @type {(action: () => any, errorMessage: string) => Promise<void>} */
  const safeRun = async (action, errorMessage) => {
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

  /** @type {(iframe?: HTMLIFrameElement | null, prevDoc?: Document | null) => Document | null} */
  const getReadyIframeDoc = (iframe, prevDoc = null) => {
    try {
      const doc = iframe?.contentDocument;
      if (
        doc?.location?.href !== SELECTORS.frames.blankUrl &&
        doc !== prevDoc &&
        doc?.body?.children?.length
      ) {
        return doc;
      }
    } catch (error) {
      console.warn("访问异常，无法获取iframe文档", error);
    }
    return null;
  };

  /** 应用运行配置对象 */
  class AppConfig {
    hasBackend = false;
    muteVideo = true;
    /** @type {number | null} */
    lockSpeed = null;
    /** @type {number | null} */
    switchingCd = null;
    quizReview = true;

    /**
     * 非空时只处理列出的附件类型，不受任务点标识或完成状态限制，也不等待任务点完成标记；处理后确认，异常时弹窗。
     * @type {Array<"Video" | "Audio" | "PDF" | "Quiz" | "Other">}
     */
    debugTaskTypes = [];

    async loadFromBackend() {
      if (!tauriInvoke) {
        tauriInvoke = async () => /** @type {any} */ (null);
        console.info("检测为无后端模式，使用默认配置");
        return;
      }
      try {
        console.info("正在从后端加载配置...");
        const res = await tauriInvoke("options");
        this.hasBackend = true;
        this.muteVideo = res.muteWebview ?? this.muteVideo;
        this.lockSpeed = res.lockSpeed ?? null;
        this.switchingCd = res.switchingCd ?? null;
        this.quizReview = res.quizReview ?? true;
        console.info("配置设置成功：", this);
      } catch (e) {
        console.error("从后端加载配置失败：", e);
      }
    }
  }

  /** 全局配置 */
  const config = new AppConfig();

  const switchingCooldown = async () => {
    if (config.switchingCd == null) return;
    await sleep(config.switchingCd * 1000, 25);
  };

  /**
   * DOM 异步等待工具库。显式声明对象类型，避免内部互调造成 TS 7 循环推断。
   * @type {{
   *   until: <T>(getter: () => T, timeout?: number, interval?: number) => Promise<T | null>,
   *   elements: <T extends HTMLElement = HTMLElement>(preAction: (() => void | Promise<void>) | null, selector: string, root: ParentNode, errorMsg?: string | false) => Promise<T[]>,
   *   element: (preAction: (() => void | Promise<void>) | null, selector: string, root: ParentNode, errorMsg?: string | false) => Promise<HTMLElement>,
   *   iframeDoc: (preAction: (() => void | Promise<void>) | null, selector: string, root: ParentNode, errorMsg?: string | false) => Promise<Document>,
   *   taskPointComplete: (container: HTMLElement) => Promise<boolean>
   * }}
   */
  const wait = {
    /** @type {<T>(getter: () => T, timeout?: number, interval?: number) => Promise<T | null>} */
    until: async (getter, timeout = 5000, interval = 250) => {
      const start = performance.now();
      while (performance.now() - start < timeout) {
        await controller.checkpoint();
        const el = await getter();
        if (el) return el;
        await sleep(interval);
      }
      return null;
    },

    /**
     * 等待指定选择器的元素列表出现并返回（非空）
     * @template {HTMLElement} [T=HTMLElement]
     * @param {(() => void | Promise<void>) | null} preAction 在等待前执行的触发动作（无触发动作传 null）
     * @param {string} selector 选择器表达式
     * @param {ParentNode} root 根查找节点
     * @param {string | false} [errorMsg=""] 错误提示信息，传 false 代表允许返回空数组的可选等待
     * @returns {Promise<T[]>}
     */
    elements: async (preAction, selector, root, errorMsg = "") => {
      if (typeof preAction === "function") await preAction();
      const nodes = /** @type {T[] | null} */ (
        await wait.until(() => {
          const list = /** @type {T[]} */ (
            Array.from(root.querySelectorAll(selector))
          );
          return list.length > 0 ? list : null;
        })
      );
      if (errorMsg !== false) {
        assert(
          nodes?.length,
          typeof errorMsg === "string" && errorMsg
            ? errorMsg
            : `等待 DOM 元素列表 [${selector}] 超时`,
        );
      }
      return nodes ?? [];
    },

    /** @type {(preAction: (() => void | Promise<void>) | null, selector: string, root: ParentNode, errorMsg?: string | false) => Promise<HTMLElement>} */
    element: async (preAction, selector, root, errorMsg = "") => {
      if (typeof preAction === "function") await preAction();
      const el = /** @type {HTMLElement | null} */ (
        await wait.until(() => root.querySelector(selector))
      );
      if (errorMsg !== false) {
        assert(
          el,
          typeof errorMsg === "string" && errorMsg
            ? errorMsg
            : `等待 DOM 节点 [${selector}] 超时`,
        );
      }
      return /** @type {HTMLElement} */ (el);
    },

    /** @type {(preAction: (() => void | Promise<void>) | null, selector: string, root: ParentNode, errorMsg?: string | false) => Promise<Document>} */
    iframeDoc: async (preAction, selector, root, errorMsg = "") => {
      let oldDoc = null;
      if (typeof preAction === "function") {
        oldDoc =
          /** @type {HTMLIFrameElement | null} */ (root.querySelector(selector))
            ?.contentDocument ?? null;
        await preAction();
      }
      /** @type {Document | null} */
      const doc = await wait.until(() =>
        getReadyIframeDoc(
          /** @type {HTMLIFrameElement | null} */ (
            root.querySelector(selector)
          ),
          oldDoc,
        ),
      );
      if (errorMsg !== false) {
        assert(
          doc,
          typeof errorMsg === "string" && errorMsg
            ? errorMsg
            : `等待 iframe [${selector}] 框架文档超时`,
        );
      }
      return /** @type {Document} */ (doc);
    },

    /** @type {(container: HTMLElement) => Promise<boolean>} */
    taskPointComplete: (container) => {
      console.info("开始监控任务点完成情况");
      if (!container) return Promise.resolve(true);

      const isDone = () =>
        container.classList.contains(SELECTORS.taskPoint.finishedClass);
      if (isDone()) return Promise.resolve(true);

      return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          if (isDone()) {
            observer.disconnect();
            console.info("任务点在 DOM 中已更新为完成状态");
            resolve(true);
          }
        });
        observer.observe(container, {
          attributes: true,
          attributeFilter: ["class"],
        });
      });
    },
  };


  /**
   * 参考/答案面板：非模态、可滚动、只读；不会点击平台提交按钮。
   * @param {string} title
   * @param {string} intro
   * @param {{ question: string, answer: string, explanation: string }[]} items
   * @returns {Promise<void>} 用户点击关闭后 resolve
   */
  const showManualReviewPanel = (title, intro, items) =>
    new Promise((resolve) => {
      const existing = document.getElementById("uxs-manual-review");
      if (existing) existing.remove();

      const panel = document.createElement("div");
      panel.id = "uxs-manual-review";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", title);
      panel.style.cssText =
        "position:fixed;top:16px;right:16px;width:min(430px,92vw);max-height:82vh;overflow:auto;z-index:2147483647;background:#fff;color:#111827;border:2px solid #1d4ed8;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.28);font:14px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;padding:14px;box-sizing:border-box;";

      const header = document.createElement("div");
      header.style.cssText = "display:flex;align-items:flex-start;gap:8px;";
      const heading = document.createElement("h2");
      heading.textContent = title;
      heading.style.cssText = "margin:0;font-size:16px;line-height:1.35;flex:1;";
      const closeIcon = document.createElement("button");
      closeIcon.type = "button";
      closeIcon.textContent = "×";
      closeIcon.setAttribute("aria-label", "关闭");
      closeIcon.style.cssText =
        "border:0;background:transparent;font-size:24px;line-height:1;cursor:pointer;color:#111827;";
      header.appendChild(heading);
      header.appendChild(closeIcon);
      panel.appendChild(header);

      const note = document.createElement("p");
      note.textContent = intro;
      note.style.cssText = "margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere;";
      panel.appendChild(note);

      for (const [index, item] of items.entries()) {
        const block = document.createElement("div");
        block.style.cssText = "border-top:1px solid #d1d5db;padding:9px 0;";
        const question = document.createElement("div");
        question.textContent = `${index + 1}. ${item.question || `第 ${index + 1} 题`}`;
        question.style.cssText = "font-weight:600;overflow-wrap:anywhere;";
        const answer = document.createElement("div");
        answer.textContent = `参考答案：${item.answer || "未生成"}`;
        answer.style.cssText = "margin-top:4px;overflow-wrap:anywhere;";
        const explanation = document.createElement("div");
        explanation.textContent = `解析：${item.explanation || "未提供"}`;
        explanation.style.cssText = "margin-top:2px;color:#374151;overflow-wrap:anywhere;";
        block.appendChild(question);
        block.appendChild(answer);
        block.appendChild(explanation);
        panel.appendChild(block);
      }

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.textContent = "关闭并停止自动化";
      closeButton.style.cssText =
        "margin-top:14px;width:100%;padding:10px 12px;border:0;border-radius:8px;background:#1d4ed8;color:#fff;font:inherit;cursor:pointer;";
      panel.appendChild(closeButton);

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        panel.remove();
        resolve();
      };
      closeIcon.addEventListener("click", close);
      closeButton.addEventListener("click", close);
      const host = document.body ?? document.documentElement;
      host.appendChild(panel);
    });

  /** @param {{ question: string, answer: string, explanation: string }[]} items */
  const formatReviewItems = (items) =>
    items
      .map(
        (item, index) =>
          `${index + 1}. ${item.question || `第 ${index + 1} 题`}\n答案：${item.answer || "未生成"}\n解析：${item.explanation || "未提供"}`,
      )
      .join("\n\n");

  /**
   * 任务级授权：默认只读；用户必须显式确认是不计分练习，才允许填写。
   * 自动提交是第二个独立确认；正式/计分信号直接拒绝。
   * @param {Document} taskDoc
   * @param {string} label
   */
  const resolveQuizPolicy = async (taskDoc, label) => {
    const pageText = String(taskDoc?.body?.innerText ?? "").slice(0, 50_000);
    if (/(禁止自动化|禁止ai|restricted)/i.test(pageText)) {
      const policy = {
        kind: "RESTRICTED",
        allowFill: false,
        allowSubmit: false,
        reason: "页面明确限制自动化",
      };
      console.info(`任务策略：${label}`, policy);
      return policy;
    }
    if (/(正式考试|考试|计分|graded|exam)/i.test(pageText)) {
      const policy = {
        kind: "GRADED",
        allowFill: false,
        allowSubmit: false,
        reason: "页面出现正式考试/计分信号",
      };
      console.info(`任务策略：${label}`, policy);
      return policy;
    }

    const allowFill = await confirm(
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

    const allowSubmit = await confirm(
      `是否允许自动提交？\n\n仅当你确认此任务明确允许自动化、且不是正式考试或计分测验时才选择 Yes。\n选择 No 将只填写答案，由你在平台原生界面手动提交。`,
    );
    const policy = {
      kind: allowSubmit ? "PRACTICE" : "UNGRADED",
      allowFill: true,
      allowSubmit,
      reason: allowSubmit ? "用户确认非计分练习并授权提交" : "用户仅授权填写",
    };
    console.info(`任务策略：${label}`, policy);
    return policy;
  };

  /** @param {{ allowSubmit?: boolean }} policy */
  const assertSubmitAllowed = (policy) => {
    if (!policy?.allowSubmit) {
      throw new ManualReviewRequired("当前任务策略不允许自动提交");
    }
  };

  /** @type {(quizDoc: Document, items: { question: string, answer: string, explanation: string }[], policy: { allowSubmit: boolean }) => Promise<void>} */
  const submitChapterQuiz = async (quizDoc, items, policy) => {
    await controller.checkpoint();
    assertSubmitAllowed(policy);
    if (config.quizReview) {
      const accepted = await confirm(
        `答案已填写完成，请人工核验后确认是否提交。\n\n${formatReviewItems(items)}\n\nYes：提交当前答案。\nNo：不提交，保留当前填写内容并停止自动化。`,
      );
      if (!accepted) {
        throw new ManualReviewRequired("用户在人工审核中拒绝提交");
      }
    }

    await controller.checkpoint();
    const submitBtn = await wait.element(
      null,
      SELECTORS.quiz.btnSubmitClass,
      quizDoc,
      "未找到题目提交按钮",
    );
    submitBtn.click();

    const modal = await wait.element(
      null,
      SELECTORS.quiz.modalId,
      document,
      "未找到提交确认弹窗",
    );
    const popOkBtn = await wait.element(
      null,
      SELECTORS.quiz.modalOkBtnId,
      modal,
      "未找到弹窗确认按钮",
    );
    let hasOpened = false;
    await wait.until(() => {
      const isVisible = getComputedStyle(modal).display !== "none";
      if (isVisible) {
        hasOpened = true;
        popOkBtn.click();
        return null;
      }
      return hasOpened ? true : null;
    });
    console.info("已按任务策略提交章节测验");
  };

  /**
   * @typedef {{ title: string, index: number, completed: number, total: number }} ChapterProgressPayload
   * @typedef {{ total: number, index: number }} TabProgressPayload
   * @typedef {{ index: number, category: string }} TaskProgressPayload
   * @typedef {
   *   | { kind: "waiting", payload: null }
   *   | { kind: "start", payload: null }
   *   | { kind: "chapter", payload: ChapterProgressPayload }
   *   | { kind: "tab", payload: TabProgressPayload }
   *   | { kind: "task", payload: TaskProgressPayload }
   *   | { kind: "cancel", payload: null }
   *   | { kind: "finish", payload: null }
   * } CourseStatus
   */

  /** @param {CourseStatus} status */
  const invokeStatus = async (status) => {
    try {
      if (tauriInvoke) {
        await tauriInvoke("send_status", { status });
      }
    } catch (e) {
      console.error("[send_status] 发送进度状态失败:", e);
    }
  };

  const emit = {
    /** @type {() => Promise<void>} */
    started: async () => {
      await invokeStatus({ kind: "start", payload: null });
    },
    /** @type {(index: number, node: HTMLElement, list: HTMLElement[]) => Promise<void>} */
    chapterProgress: async (index, node, list) => {
      const title =
        node
          .querySelector(SELECTORS.courseTree.nameClass)
          ?.textContent?.trim() ||
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
    /** @type {() => Promise<void>} */
    cancelled: async () => {
      await invokeStatus({ kind: "cancel", payload: null });
    },
    /** @type {() => Promise<void>} */
    finished: async () => {
      await invokeStatus({ kind: "finish", payload: null });
    },
  };

  /**
   * 预先对视频节点做静音处理 (播放前调用)
   * @param {HTMLMediaElement} videoEl
   */
  const muteVideo = (videoEl) => {
    if (!videoEl) return;
    videoEl.muted = true;
    videoEl.defaultMuted = true;
  };

  /**
   * 视频真实播放后施加倍速与锁定 (播放后调用)
   * @param {HTMLMediaElement} videoEl
   * @param {number} targetRate
   */
  const applySpeed = (videoEl, targetRate) => {
    videoEl.playbackRate = targetRate;
    Object.defineProperty(videoEl, "playbackRate", {
      get: () => targetRate,
      set: () => {},
      configurable: true,
    });
  };

  /**
   * 获取页面中所有课程章节 DOM 节点列表
   * @param {Document} document
   * @returns {HTMLElement[]}
   */
  const chapterNodes = (document) => {
    const nodes = /** @type {HTMLElement[]} */ (
      Array.from(document.querySelectorAll(SELECTORS.courseTree.nodeClass))
    );
    if (nodes.length > 0)
      console.info(`获取课程列表成功，共 ${nodes.length} 个章节`);
    else console.error("获取课程列表失败");

    return nodes;
  };

  /**
   * 获取课程章节状态
   * @param {HTMLElement} node
   * @returns {'Blocking' | 'Interactive' | 'Finished' | 'Title' | 'Unknown'}
   */
  const chapterNodeStatus = (node) => {
    /** @type {HTMLElement | null} */
    const nameSpan = node.querySelector(SELECTORS.courseTree.nameClass);
    if (!nameSpan)
      return node.matches(SELECTORS.courseTree.titleSelector)
        ? "Title"
        : "Unknown";
    if (nameSpan.onclick == null) return "Blocking";
    return node.matches(SELECTORS.courseTree.unfinishedSelector)
      ? "Interactive"
      : "Finished";
  };

  /** @type {(taskDoc: Document) => "Video" | "Audio" | "PDF" | "Quiz" | "Other"} */
  const classifyTask = (taskDoc) => {
    const url = taskDoc.location.href;
    if (url.includes(SELECTORS.urls.video)) return "Video";
    if (url.includes(SELECTORS.urls.audio)) return "Audio";
    if (url.includes(SELECTORS.urls.pdf)) return "PDF";
    if (url.includes(SELECTORS.urls.quiz)) return "Quiz";
    return "Other";
  };

  /**
   * @typedef {{ answered?: boolean, answerContent?: string, description?: string, resourceId?: number | string, memberinfo?: string, questionType?: string, options?: { name?: string }[] }} ExtQuizData
   * @typedef {{ style?: string, datas?: ExtQuizData[] }} ExtQuizObject
   * @typedef {{ validationUrl2?: string, objects?: ExtQuizObject[] }} ExtTimeline
   * @typedef {Window & { Ext?: { getCmp?: (id: string) => ExtTimeline | undefined } }} VideoWindow
   * @typedef {{ isRight?: boolean | number | string }} ExtValidationResult
   * @typedef {{ element: HTMLElement, data: ExtQuizData }} InteractiveQuizItem
   */

  /**
   * @param {string} validationUrl
   * @param {ExtQuizData} quizData
   * @param {string} answerContent
   * @param {string} host
   * @returns {string}
   */
  const buildValidationUrl = (validationUrl, quizData, answerContent, host) => {
    const url = new URL(validationUrl, host);
    url.searchParams.set("_dc", String(Date.now()));
    url.searchParams.set("eventid", String(quizData.resourceId));
    url.searchParams.set("memberinfo", String(quizData.memberinfo));
    url.searchParams.set("answerContent", answerContent);
    return url.href;
  };

  /** @param {ExtQuizData} quizData @returns {string[]} */
  const getAnswerCandidates = (quizData) => {
    const optionNames = (quizData.options ?? [])
      .map(({ name }) =>
        String(name ?? "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);

    /** @type {string[]} */
    const candidates = [];
    /** @type {boolean} */
    const isMulti = String(quizData.questionType ?? "").includes("多选");
    for (const optionName of optionNames) {
      /** @type {string[]} */
      const previous = candidates.slice();
      candidates.push(optionName);
      if (isMulti) {
        for (const candidate of previous)
          candidates.push(`${candidate},${optionName}`);
      }
    }
    return candidates;
  };

  /**
   * @param {string} url
   * @returns {Promise<ExtValidationResult>}
   */
  const requestValidation = async (url) => {
    await switchingCooldown();
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok)
      throw new Error(`互动题验证请求失败：HTTP ${response.status}`);
    return /** @type {ExtValidationResult} */ (await response.json());
  };

  /**
   * @param {string} validationUrl
   * @param {ExtQuizData} quizData
   * @param {string} host
   * @returns {Promise<string>}
   */
  const resolveInteractiveQuizAnswer = async (
    validationUrl,
    quizData,
    host,
  ) => {
    const candidates = getAnswerCandidates(quizData);
    for (let index = candidates.length - 1; index > 0; index--) {
      const target = Math.floor(Math.random() * (index + 1));
      [candidates[index], candidates[target]] = [
        candidates[target],
        candidates[index],
      ];
    }
    console.info("开始验证互动题候选答案", {
      resourceId: quizData.resourceId,
      description: quizData.description,
      candidateCount: candidates.length,
    });
    /** @type {{ answerContent: string, isRight: ExtValidationResult["isRight"] }[]} */
    const results = [];
    try {
      for (const answerContent of candidates) {
        const result = await requestValidation(
          buildValidationUrl(validationUrl, quizData, answerContent, host),
        );
        results.push({ answerContent, isRight: result.isRight });
        console.info("互动题候选答案验证结果", {
          resourceId: quizData.resourceId,
          answerContent,
          isRight: result.isRight,
        });
        if (result.isRight) return answerContent;
      }
    } catch (error) {
      console.error(
        "互动题候选答案验证请求失败",
        {
          resourceId: quizData.resourceId,
          description: quizData.description,
          results,
        },
        error,
      );
      throw error;
    }
    throw new Error(
      `互动题验证未返回正确答案（候选数：${candidates.length}）：${JSON.stringify(results)}`,
    );
  };

  /** @type {(timeline: HTMLElement) => Promise<ExtQuizData[]>} */
  const getInteractiveQuizData = async (timeline) => {
    const videoWindow = /** @type {VideoWindow | null} */ (
      timeline.ownerDocument.defaultView
    );
    const component = videoWindow?.Ext?.getCmp?.(timeline.id);
    if (!component?.objects?.length) return [];

    const quizObjects = component.objects.filter(
      ({ style, datas }) =>
        (style === "QUIZ" || style === "InteractiveQuiz") && datas?.length,
    );
    if (!quizObjects.length) return [];

    const host = timeline.ownerDocument.location.origin;
    const datas = /** @type {ExtQuizData[]} */ (
      structuredClone(quizObjects.flatMap(({ datas }) => datas))
    );
    /** @param {unknown} error */
    const showAnswerFailure = async (error) => {
      const snapshot = {
        timelineId: timeline.id,
        validationUrl2: component.validationUrl2,
        objects: quizObjects,
        quizDatas: datas,
        error: error instanceof Error ? error.message : String(error),
      };
      const details = JSON.stringify(snapshot, null, 2);
      console.error("互动题答案未能解析，Ext 数据快照：", snapshot);
      await confirm(`互动题答案获取失败，请检查 Ext 数据：\n\n${details}`);
    };

    for (const quizData of datas) {
      const existingAnswer = String(quizData.answerContent ?? "").trim();
      if (existingAnswer) {
        console.info("互动题使用 Ext 中已有答案", {
          resourceId: quizData.resourceId,
          description: quizData.description,
          answerContent: existingAnswer,
        });
        continue;
      }

      try {
        quizData.answerContent = await resolveInteractiveQuizAnswer(
          /** @type {string} */ (component.validationUrl2),
          quizData,
          host,
        );
      } catch (error) {
        await showAnswerFailure(error);
        throw error;
      }
    }

    const unanswered = datas.filter(
      ({ answerContent }) => !String(answerContent ?? "").trim(),
    );
    if (unanswered.length) {
      const error = new Error(`互动题答案缺失（${unanswered.length} 道）`);
      await showAnswerFailure(error);
      throw error;
    }

    return datas;
  };

  /** @type {(timeline: HTMLElement, videoEl: HTMLMediaElement) => Promise<HTMLElement | null>} */
  const observeInteractiveQuiz = (timeline, videoEl) => {
    return new Promise((resolve) => {
      const observer = new MutationObserver(check);

      function check() {
        const quizRoot = /** @type {HTMLElement | null} */ (
          timeline.querySelector(SELECTORS.video.quizClass)
        );
        if (!quizRoot && !videoEl.ended) return;
        observer.disconnect();
        videoEl.removeEventListener("ended", check);
        resolve(quizRoot);
      }

      observer.observe(timeline, { childList: true, subtree: true });
      videoEl.addEventListener("ended", check, { once: true });
      check();
    });
  };
  /** @type {(optionNode: HTMLElement) => void} */
  const clickInteractiveQuizOption = (optionNode) =>
    optionNode.querySelector("label")?.click();

  /** @type {(quizRoot: HTMLElement, quizData: ExtQuizData) => Promise<void>} */
  const fillInteractiveQuiz = async (quizRoot, quizData) => {
    const optionNodes = await wait.elements(
      null,
      SELECTORS.video.quizOptionClass,
      quizRoot,
    );
    const answerNames = new Set(
      String(quizData.answerContent ?? "")
        .toUpperCase()
        .match(/[A-Z0-9]/g) ?? [],
    );
    for (const input of quizRoot.querySelectorAll("input")) {
      input.checked = false;
      input.removeAttribute("checked");
    }
    for (const [index, option] of (quizData.options ?? []).entries()) {
      const optionNode = optionNodes[index];
      if (optionNode && answerNames.has(String(option.name).toUpperCase())) {
        clickInteractiveQuizOption(optionNode);
      }
    }
  };

  /** @type {(quizRoot: HTMLElement, quizDatas: ExtQuizData[]) => Promise<InteractiveQuizItem[]>} */
  const matchInteractiveQuizItems = async (quizRoot, quizDatas) => {
    const quizItems = await wait.elements(
      null,
      SELECTORS.video.quizItemClass,
      quizRoot,
    );
    /** @type {InteractiveQuizItem[]} */
    const items = [];
    for (const quizItem of quizItems) {
      const title = (
        await wait.element(null, SELECTORS.video.quizTitleClass, quizItem)
      ).textContent
        ?.trim()
        .replace(/\s+/g, " ");
      const matches = quizDatas.filter(
        ({ description }) => description?.trim().replace(/\s+/g, " ") === title,
      );
      assert(matches.length === 1, `互动题题干未唯一匹配：${title}`);
      items.push({ element: quizItem, data: matches[0] });
    }
    return items;
  };

  /** @type {(items: InteractiveQuizItem[], quizDatas: ExtQuizData[]) => Promise<void>} */
  const fillInteractiveQuizItems = async (items, quizDatas) => {
    for (const { element, data } of items) {
      await controller.checkpoint();
      await switchingCooldown();
      console.info(
        `开始处理第 ${quizDatas.indexOf(data) + 1}/${quizDatas.length} 道互动题`,
        { resourceId: data.resourceId, title: data.description },
      );
      await fillInteractiveQuiz(element, data);
    }
  };

  /**
   * @param {HTMLElement} quizRoot
   * @param {{ question: string, answer: string, explanation: string }[]} items
   * @param {{ allowSubmit: boolean }} policy
   */
  const submitInteractiveQuiz = async (quizRoot, items, policy) => {
    await controller.checkpoint();
    assertSubmitAllowed(policy);
    if (config.quizReview) {
      const accepted = await confirm(
        `互动题答案已填写，请人工核验。

${formatReviewItems(items)}

Yes：提交当前互动题。
No：不提交并停止自动化。`,
      );
      if (!accepted) throw new ManualReviewRequired("用户在互动题人工审核中拒绝提交");
    }
    await controller.checkpoint();
    const submitButton = await wait.element(
      null,
      SELECTORS.video.quizSubmitId,
      quizRoot,
    );
    submitButton.click();

    const continueButton = await wait.element(
      null,
      SELECTORS.video.quizContinueId,
      quizRoot,
      false,
    );

    if (continueButton) {
      await wait.until(() => {
        if (getComputedStyle(continueButton).display === "none") return null;
        continueButton.click();
        return true;
      });
    }
  };

  /** @type {(taskDoc: Document, videoEl: HTMLMediaElement) => Promise<void>} */
  const handleInteractiveQuiz = async (taskDoc, videoEl) => {
    await controller.checkpoint();
    const timeline = await wait.element(
      null,
      SELECTORS.video.timelineClass,
      taskDoc,
    );
    const policy = await resolveQuizPolicy(taskDoc, "视频互动题");
    if (!policy.allowFill) {
      await showManualReviewPanel(
        "需要人工处理视频互动题",
        `策略：${policy.kind}（${policy.reason}）。

本工具不会自动读取、验证或提交互动题答案。请直接在播放器中原生完成。`,
        [],
      );
      throw new ManualReviewRequired("视频互动题未授权自动填写");
    }

    const quizDatas = await getInteractiveQuizData(timeline);
    await controller.checkpoint();
    console.info(
      quizDatas.length
        ? `视频包含 ${quizDatas.length} 道互动题，开始处理`
        : "视频无互动题",
    );
    if (!quizDatas.length) return;
    const reviewItems = quizDatas.map((data) => ({
      question: data.description || "视频互动题",
      answer: String(data.answerContent ?? ""),
      explanation: "",
    }));
    if (!policy.allowSubmit) {
      await showManualReviewPanel(
        "互动题答案已填写，但不会自动提交",
        "请在播放器中原生核对并手动提交；关闭本面板后自动化停止。",
        reviewItems,
      );
      throw new ManualReviewRequired("互动题仅授权填写，未授权提交");
    }

    const lastQuizData = quizDatas[quizDatas.length - 1];
    let lastQuizSubmitted = false;
    while (!lastQuizSubmitted) {
      const quizRoot = await observeInteractiveQuiz(timeline, videoEl);
      if (!quizRoot) break;
      const items = await matchInteractiveQuizItems(quizRoot, quizDatas);
      await fillInteractiveQuizItems(items, quizDatas);
      await submitInteractiveQuiz(quizRoot, reviewItems, policy);
      lastQuizSubmitted = items.some(
        ({ data }) => data.resourceId === lastQuizData.resourceId,
      );
    }
    console.info(
      lastQuizSubmitted
        ? "视频互动题处理完毕，最后一道题已按策略提交"
        : "视频已结束，停止处理互动题",
    );
  };

  /** @type {(taskDoc: Document) => Promise<void>} */
  const handleVideo = async (taskDoc) => {
    console.info("开始处理Video任务点");
    const launchBtn = await wait.element(
      null,
      SELECTORS.video.launchBtnClass,
      taskDoc,
      "未找到视频播放按钮",
    );
    const videoEl = /** @type {HTMLMediaElement} */ (
      await wait.element(
        null,
        SELECTORS.video.tag,
        taskDoc,
        "未找到视频播放控件",
      )
    );
    controller.setMedia(videoEl);
    if (config.muteVideo) muteVideo(videoEl);

    const isStarted = await wait.until(() => {
      if (videoEl?.currentTime > 0 && !videoEl.paused) return true;
      launchBtn.click();
      return null;
    });
    if (!isStarted) throw new Error("视频多次尝试无法启动播放");

    if (config.lockSpeed != null) applySpeed(videoEl, config.lockSpeed);
    await handleInteractiveQuiz(taskDoc, videoEl);
    console.info("Video任务点处理完成");

    if (config.debugTaskTypes.includes("Video")) {
      await sleep(5000);
      assert(
        await confirm(
          "[DEBUG] Video 任务点处理完成。点击 [确定] 继续，点击 [取消] 中断。",
        ),
        "调试中断：用户取消了 Video 任务点",
      );
    }
  };

  /** @type {(taskDoc: Document) => Promise<void>} */
  const handleAudio = async (taskDoc) => {
    console.info("开始处理Audio任务点");
    const launchBtn = await wait.element(
      null,
      SELECTORS.audio.launchBtnClass,
      taskDoc,
      "未找到音频播放按钮",
    );
    const audioEl = /** @type {HTMLAudioElement} */ (
      await wait.element(
        null,
        SELECTORS.audio.tag,
        taskDoc,
        "未找到音频播放控件",
      )
    );
    controller.setMedia(audioEl);
    if (config.muteVideo) muteVideo(audioEl);

    const isStarted = await wait.until(() => {
      if (audioEl.currentTime > 0 && !audioEl.paused) return true;
      if (audioEl.paused) launchBtn.click();
      return null;
    });
    assert(isStarted, "音频多次尝试无法启动播放");
    if (config.lockSpeed != null) applySpeed(audioEl, config.lockSpeed);

    // preload=none 的播放器启动后才加载时长。
    const duration = await wait.until(() =>
      Number.isFinite(audioEl.duration) && audioEl.duration > 0
        ? audioEl.duration
        : null,
    );
    assert(duration != null, "等待音频时长超时");
    console.info("Audio任务点处理完成，等待平台完成标记");

    if (config.debugTaskTypes.includes("Audio")) {
      assert(
        await confirm(
          "[DEBUG] Audio 任务点处理完成。点击 [确定] 继续，点击 [取消] 中断。",
        ),
        "调试中断：用户取消了 Audio 任务点",
      );
    }
  };

  /** @type {(taskDoc: Document) => Promise<void>} */
  const handlePDF = async (taskDoc) => {
    console.info("开始处理PDF任务点");
    const pdfDoc = await wait.iframeDoc(
      null,
      SELECTORS.pdf.iframeId,
      taskDoc,
      "获取 PDF 框架文档超时",
    );
    const container = pdfDoc.documentElement;
    const isScrolled = await wait.until(async () => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
      await sleep(750);
      if (
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 10
      ) {
        return true;
      }
      return null;
    });

    if (!isScrolled) throw new Error("多次尝试后 PDF 仍未滚动");
    console.info("PDF任务点处理完成");

    if (config.debugTaskTypes.includes("PDF")) {
      assert(
        await confirm(
          "[DEBUG] PDF 任务点自动滚动完成。点击 [确定] 继续，点击 [取消] 中断。",
        ),
        "调试中断：用户取消了 PDF 任务点",
      );
    }
  };

  /**
   * 清空单个题目 DOM 中的已有勾选/选中状态（针对单选、多选、判断）
   * @param {HTMLElement} quizDiv 题目容器
   */
  const cleanup = (quizDiv) => {
    /** @type {NodeListOf<HTMLElement>} */
    const selectedList = quizDiv.querySelectorAll(
      SELECTORS.quiz.clearSelectedClass,
    );
    for (const el of selectedList) /** @type {HTMLElement} */ (el).click();
  };

  /** @type {(titleText: string) => "single" | "multi" | "judge" | "completion" | "short"} */
  const classifyQuestion = (titleText) => {
    const text = String(titleText).toLowerCase();
    if (text.includes("多选")) return "multi";
    if (text.includes("判断")) return "judge";
    if (text.includes("单选")) return "single";
    if (text.includes("填空")) return "completion";
    if (text.includes("简答")) return "short";
    if (text.includes("计算")) return "short"; // 换汤不换药

    assert(false, `未识别的题目类型: "${titleText}"`);
  };

  /** @type {(quizDiv: HTMLElement, content: string) => void} */
  const fillSingle = (quizDiv, content) => {
    const rawContent = String(content).trim();
    assert(rawContent, "单选题 AI 返回答案为空，拒绝提交");
    /** @type {HTMLElement | null} */
    const opt = quizDiv.querySelector(`span.num_option[data="${rawContent}"]`);
    assert(opt, `单选题未找到对应选项 [${rawContent}]，拒绝提交`);
    opt.click();
  };

  /** @type {(quizDiv: HTMLElement, content: string) => void} */
  const fillMulti = (quizDiv, content) => {
    const ansArr = String(content).match(/[A-Z0-9]/gi);
    assert(
      ansArr?.length,
      `多选题 AI 答案无法解析为有效选项 [${content}]，拒绝提交`,
    );

    for (const ch of ansArr) {
      /** @type {HTMLElement | null} */
      const opt = quizDiv.querySelector(`span.num_option_dx[data="${ch}"]`);
      assert(opt, `多选题未找到选项 [${ch}]，拒绝提交`);
      opt.click();
    }
  };

  /** @type {(quizDiv: HTMLElement, content: string) => void} */
  const fillJudge = (quizDiv, content) => {
    const trimmed = String(content).trim();
    assert(trimmed, "判断题 AI 返回答案为空，拒绝提交");
    const val = ["A", "对", "t", "T", "true", "1"].includes(trimmed[0])
      ? "true"
      : "false";
    /** @type {HTMLElement | null} */
    const opt = quizDiv.querySelector(`span.num_option[data="${val}"]`);
    assert(opt, `判断题未找到对应选项 [${val}]，拒绝提交`);
    opt.click();
  };

  /** @type {(container: ParentNode, text: string, errorPrefix: string) => Promise<void>} */
  const setUEditorContent = async (container, text, errorPrefix) => {
    const textarea = await wait.element(
      null,
      SELECTORS.quiz.textarea,
      container,
      `${errorPrefix}未找到答案 textarea 节点`,
    );

    const win =
      /** @type {Window & { UE?: { getEditor: (id: string) => { isReady?: number | boolean; setContent: (html: string) => void } } }} */ (
        textarea.ownerDocument.defaultView
      );
    const editor = await wait.until(() => {
      if (typeof win?.UE?.getEditor !== "function") return null;
      const inst = win.UE.getEditor(textarea.id);
      return inst?.isReady ? inst : null;
    });
    assert(editor, `${errorPrefix}UEditor 编辑器未就绪`);
    editor.setContent(text);
  };

  /** @type {(quizDiv: HTMLElement, content: string) => Promise<void>} */
  const fillCompletion = async (quizDiv, content) => {
    const ansArr = String(content)
      .split(";")
      .map((s) => s.trim());
    const itemDivs = await wait.elements(
      null,
      SELECTORS.quiz.blankItemDiv,
      quizDiv,
    );

    for (const [index, itemDiv] of itemDivs.entries()) {
      assert(ansArr[index], `填空题缺少第 ${index + 1} 空的对应答案，拒绝提交`);
      await setUEditorContent(
        itemDiv,
        ansArr[index],
        `填空题第 ${index + 1} 空`,
      );
    }
  };

  /** @type {(quizDiv: HTMLElement, content: string) => Promise<void>} */
  const fillShort = async (quizDiv, content) => {
    const val = String(content).trim();
    assert(val, "简答题 AI 返回答案为空，拒绝提交");
    await setUEditorContent(quizDiv, val, "简答题");
  };

  /** @type {(quizList: HTMLElement[], answersList: { content: string }[]) => Promise<void>} */
  const applyAnswers = async (quizList, answersList) => {
    assert(
      quizList.length === answersList.length,
      `AI 返回答案数 (${answersList.length}) 与题目数 (${quizList.length}) 不匹配，拒绝提交`,
    );
    const questionFillers = {
      single: fillSingle,
      multi: fillMulti,
      judge: fillJudge,
      completion: fillCompletion,
      short: fillShort,
    };
    for (const [index, quizDiv] of quizList.entries()) {
      await controller.checkpoint();
      await switchingCooldown();
      cleanup(quizDiv);
      const titleEl = quizDiv.querySelector(SELECTORS.quiz.titleClass);
      assert(
        titleEl?.textContent,
        `第 ${index + 1} 题未能获取题目标题，拒绝提交`,
      );
      await questionFillers[classifyQuestion(titleEl.textContent)](
        quizDiv,
        answersList[index].content,
      );
    }
  };

  /** @type {(taskDoc: Document) => Promise<void>} */
  const handleQuiz = async (taskDoc) => {
    console.info("开始处理Quiz任务点");
    const quizDoc = await wait.iframeDoc(
      null,
      SELECTORS.quiz.frameContentId,
      taskDoc,
      "获取答题框架文档超时",
    );
    const quizList = await wait.elements(
      null,
      SELECTORS.quiz.singleQuesClass,
      quizDoc,
    );

    await controller.checkpoint();
    let answersList;
    try {
      answersList = await tauriInvoke("solve_quiz", {
        html: quizDoc.documentElement.outerHTML,
      });
    } catch (error) {
      throw new ManualReviewRequired(
        `Quiz 答案生成失败，未填写/未提交：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!Array.isArray(answersList) || answersList.length === 0) {
      throw new ManualReviewRequired("Quiz 未生成答案，未填写/未提交");
    }

    const items = answersList.map((answer, index) => {
      const titleEl = quizList[index]?.querySelector(SELECTORS.quiz.titleClass);
      return {
        question:
          titleEl?.textContent?.trim().replace(/\s+/g, " ") ||
          `第 ${index + 1} 题`,
        answer: String(answer?.content ?? "").trim(),
        explanation: String(answer?.explanation ?? "").trim(),
      };
    });
    await controller.checkpoint();
    const policy = await resolveQuizPolicy(taskDoc, "章节测验");
    if (!policy.allowFill) {
      await showManualReviewPanel(
        "参考答案（未自动填写/提交）",
        `策略：${policy.kind}（${policy.reason}）。

工具没有填写或提交任何答案。请在本页面手动核对并提交。`,
        items,
      );
      throw new ManualReviewRequired("章节测验未授权自动填写");
    }

    await applyAnswers(quizList, answersList);
    if (!policy.allowSubmit) {
      await showManualReviewPanel(
        "答案已填入，但不会自动提交",
        "请在平台原生界面核对并手动提交；关闭本面板后自动化停止。",
        items,
      );
      throw new ManualReviewRequired("章节测验仅授权填写，未授权提交");
    }

    if (config.debugTaskTypes.includes("Quiz")) {
      assert(
        await confirm(
          "[DEBUG] 答案已自动填充完成。点击[确定]继续提交，点击[取消]中断提交。",
        ),
        "调试中断：用户取消了 Quiz 提交",
      );
    }
    await submitChapterQuiz(quizDoc, items, policy);
    console.info("章节测验已按任务策略处理");
  };

  /** @type {(chapterDoc: Document) => Promise<void>} */
  const handleTab = async (chapterDoc) => {
    const debugging = config.debugTaskTypes.length > 0;
    const containers = await wait.elements(
      null,
      debugging
        ? SELECTORS.taskPoint.attachmentSelector
        : SELECTORS.taskPoint.containerSelector,
      chapterDoc,
      debugging ? false : "",
    );
    for (const [index, container] of containers.entries()) {
      const taskInfo = `第 ${index + 1}/${containers.length} 个任务点`;
      const taskIframe = /** @type {HTMLIFrameElement} */ (
        await wait.element(
          null,
          SELECTORS.taskPoint.iframeTag,
          container,
          "未找到任务点 iframe 节点",
        )
      );
      const taskDoc = await wait.until(() => getReadyIframeDoc(taskIframe));
      assert(taskDoc, "获取任务文档失败，文档对象为空");
      console.info(taskInfo);

      const taskHandler = {
        Video: handleVideo,
        Audio: handleAudio,
        PDF: handlePDF,
        Quiz: handleQuiz, // 依赖tauriInvoke来AI答题
        Other: null,
      };
      const type = classifyTask(taskDoc);
      if (debugging && !config.debugTaskTypes.includes(type)) continue;
      const classification =
        type === "Quiz"
          ? "NEEDS_CONFIRMATION"
          : ["Video", "Audio", "PDF"].includes(type)
            ? "LEARNING"
            : "RESTRICTED";
      console.info(`任务分类：${taskInfo}`, { type, classification });
      await emit.taskProgress(index, type);
      const handler = taskHandler[type];
      if (
        !debugging &&
        container.classList.contains(SELECTORS.taskPoint.finishedClass)
      ) {
        console.info(`${taskInfo} 已完成，自动跳过`);
        continue;
      }

      await controller.checkpoint();
      await switchingCooldown();
      await safeRun(async () => {
        assert(handler, `未识别的任务点类型: ${taskDoc.location.href}`);
        if (type === "Quiz")
          assert(config.hasBackend, "未开启后端服务，无法处理Quiz任务点");

        await handler(taskDoc);
        if (!debugging) await wait.taskPointComplete(container);
      }, `${taskInfo} 处理异常，自动跳过，任务点类别：${type}`);
    }
  };

  /** @type {(node: HTMLElement) => Promise<void>} */
  const handleChapter = async (node) => {
    /** @type {HTMLElement | null} */
    const nameSpan = node.querySelector(SELECTORS.courseTree.nameClass);
    assert(nameSpan, "节点获取章节名称失败");
    console.info(`开始进入章节[${nameSpan.getAttribute("title")}]`);

    // 单页章节依然保留了隐藏的 Tab 元素，因此至少有一个 Tab
    const tabs = await wait.elements(
      () => nameSpan.click(),
      SELECTORS.chapter.tabClass,
      document,
    );
    for (const [index, tab] of tabs.entries()) {
      await emit.tabProgress(index, tabs.length);
      await safeRun(async () => {
        console.info("等待章节主框架加载");
        const chapterDoc = await wait.iframeDoc(
          () => tab.click(),
          SELECTORS.frames.chapterFrameId,
          document,
          "获取章节主框架超时",
        );
        await handleTab(chapterDoc);
      }, "页签处理失败，自动跳过该页签");
    }
    console.info("本章节处理完毕");
  };

  /** @param {HTMLElement[]} chapterList */
  const handleCourse = async (chapterList) => {
    for (const [index, node] of chapterList.entries()) {
      await emit.chapterProgress(index, node, chapterList);
      if (
        chapterNodeStatus(node) !== "Interactive" &&
        config.debugTaskTypes.length === 0
      ) {
        continue;
      }
      await safeRun(() => handleChapter(node), "章节处理失败，自动跳过该章节");
    }
  };

  /** @param {HTMLElement[]} chapterList */
  const blockingCount = (chapterList) =>
    chapterList.filter((node) => chapterNodeStatus(node) === "Blocking").length;

  const totalChapterList = () => {
    return chapterNodes(document).filter((node) => {
      const status = chapterNodeStatus(node);
      return (
        status === "Interactive" ||
        status === "Finished" ||
        status === "Blocking"
      );
    });
  };

  /** 脚本全流程执行主入口 */
  const main = async () => {
    await config.loadFromBackend();

    const speedInfo =
      config.lockSpeed != null ? `${config.lockSpeed}x (已锁定)` : "不锁定";
    const cdInfo =
      config.switchingCd != null ? `${config.switchingCd}秒 (±25%)` : "已关闭";
    const configSummary = `当前配置：[视频倍速: ${speedInfo} | 切换 CD: ${cdInfo} | 自动静音: ${config.muteVideo ? "已开启" : "已关闭"}]`;

    const isConfirmed = await confirm(
      `[使用须知与运行指南]
1. 免责声明：本脚本仅供自动化测试与学习交流使用，请遵守相关法律法规及平台规定。
2. 前置准备：建议关闭浏览器开发者工具(DevTools)，避免触发调试拦截。
3. ${configSummary}

[操作说明]
• 点击“确定”：立即启动自动化流程。
• 点击“取消”：放弃并退出脚本运行。
• 紧急停止：运行过程中按 F5 刷新页面即可终止脚本。

是否确认开始运行？`,
    );
    if (!isConfirmed) {
      console.info("用户已取消脚本运行");
      await emit.cancelled();
      return;
    }
    await emit.started();
    controller.start();

    try {
      do {
        await safeRun(() => handleCourse(totalChapterList()), "课程处理失败");
        if (config.debugTaskTypes.length === 0) await sleep(5000);
        // debug 只扫描一轮，其他类型的任务未处理时，章节可能一直保持 Blocking。
      } while (
        config.debugTaskTypes.length === 0 &&
        blockingCount(totalChapterList()) > 0
      );

      controller.finish();
      await emit.finished();
    } catch (error) {
      if (error instanceof AutomationStopped) {
        console.info(error.message);
        controller.finish();
        await emit.cancelled();
        return;
      }
      controller.setState(TaskState.FAILED);
      throw error;
    }
  };

  main();
})();

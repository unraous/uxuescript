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
      quizOptionClass: ".ans-videoquiz-opt",
      quizSubmitId: "#videoquiz-submit",
      quizContinueId: "#videoquiz-continue",
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
      iframeTag: "iframe",
    },
    frames: {
      blankUrl: "about:blank",
      chapterFrameId: "#iframe",
    },
    urls: {
      video: "/ananas/modules/video/",
      pdf: "/ananas/modules/pdf/",
      quiz: "/ananas/modules/work/",
    },
  };

  /** @type {(ms: number) => Promise<void>} */
  const sleep = (ms) =>
    new Promise((resolve) => window.setTimeout(resolve, ms));

  /** @type {(cond: any, msg: string) => asserts cond} */
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  /** @type {(action: () => any, errorMessage: string) => Promise<void>} */
  const safeRun = async (action, errorMessage) => {
    try {
      await action();
    } catch (e) {
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
    lockingSpeed = false;
    videoSpeedValue = 2.0;

    /**
     * 调试重试的任务类型列表 (空数组代表正常生产模式，非空如 ["Quiz"] 代表开启该类型的调试重试与确认卡点)
     * @type {Array<"Video" | "PDF" | "Quiz" | "Other">}
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
        this.lockingSpeed = res.speedLock ?? this.lockingSpeed;
        this.videoSpeedValue = res.speedValue ?? this.videoSpeedValue;
        console.info("配置设置成功：", this);
      } catch (e) {
        console.error("从后端加载配置失败：", e);
      }
    }
  }

  /** 全局配置 */
  const config = new AppConfig();

  /** DOM 异步等待工具库 */
  const wait = {
    /** @type {<T>(getter: () => T, timeout?: number, interval?: number) => Promise<T | null>} */
    until: async (getter, timeout = 5000, interval = 250) => {
      const start = performance.now();
      while (performance.now() - start < timeout) {
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
   * @typedef {{ title: string, index: number, completed: number, total: number }} ChapterProgressPayload
   * @typedef {{ total: number, index: number }} TabProgressPayload
   * @typedef {{ index: number, category: string }} TaskProgressPayload
   * @typedef {
   *   | { kind: "waiting", payload: null }
   *   | { kind: "started", payload: null }
   *   | { kind: "chapterProgress", payload: ChapterProgressPayload }
   *   | { kind: "tabProgress", payload: TabProgressPayload }
   *   | { kind: "taskProgress", payload: TaskProgressPayload }
   *   | { kind: "cancelled", payload: null }
   *   | { kind: "finished", payload: null }
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
    if (nodes.length > 0) console.info("获取课程列表成功：", nodes);
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

  /** @type {(taskDoc: Document) => "Video" | "PDF" | "Quiz"} */
  const classifyTask = (taskDoc) => {
    const url = taskDoc.location.href;
    if (url.includes(SELECTORS.urls.video)) return "Video";
    if (url.includes(SELECTORS.urls.pdf)) return "PDF";
    if (url.includes(SELECTORS.urls.quiz)) {
      assert(config.hasBackend, "未开启后端服务，无法处理Quiz任务点");
      return "Quiz";
    }
    throw new Error(`未识别的任务点类型: ${url}`);
  };

  /**
   * @typedef {{ answered?: boolean, answerContent?: string, resourceId?: number | string, memberinfo?: string, questionType?: string, options?: { name?: string }[] }} ExtQuizData
   * @typedef {{ style?: string, datas?: ExtQuizData[] }} ExtQuizObject
   * @typedef {{ validationUrl2?: string, objects?: ExtQuizObject[] }} ExtTimeline
   * @typedef {Window & { Ext?: { getCmp?: (id: string) => ExtTimeline | undefined } }} VideoWindow
   * @typedef {{ isRight?: boolean | number | string }} ExtValidationResult
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
          candidates.push(candidate + optionName);
      }
    }
    return candidates;
  };

  /**
   * @param {string} url
   * @returns {Promise<ExtValidationResult>}
   */
  const requestValidation = async (url) => {
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
    const results = await Promise.all(
      candidates.map(async (answerContent) => ({
        answerContent,
        result: await requestValidation(
          buildValidationUrl(validationUrl, quizData, answerContent, host),
        ),
      })),
    );
    const correct = results.find(({ result }) => result.isRight);
    if (!correct) throw new Error("互动题验证未返回正确答案");
    return correct.answerContent;
  };

  /** @type {(timeline: HTMLElement) => Promise<ExtQuizData[]>} */
  const getInteractiveQuizData = async (timeline) => {
    const videoWindow = /** @type {VideoWindow | null} */ (
      timeline.ownerDocument.defaultView
    );
    const component = videoWindow?.Ext?.getCmp?.(timeline.id);
    if (!component?.objects?.length) return [];

    const quizObject = component.objects.find(
      ({ style }) => style === "QUIZ" || style === "InteractiveQuiz",
    );
    if (!quizObject?.datas?.length) return [];

    const host = timeline.ownerDocument.location.origin;
    const datas = /** @type {ExtQuizData[]} */ (
      structuredClone(quizObject.datas)
    );
    for (const quizData of datas) {
      if (!String(quizData.answerContent ?? "").trim()) {
        quizData.answerContent = await resolveInteractiveQuizAnswer(
          /** @type {string} */ (component.validationUrl2),
          quizData,
          host,
        );
      }
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

  /** @type {(taskDoc: Document, videoEl: HTMLMediaElement) => Promise<void>} */
  const handleInteractiveQuiz = async (taskDoc, videoEl) => {
    const timeline = await wait.element(
      null,
      SELECTORS.video.timelineClass,
      taskDoc,
    );
    const quizDatas = await getInteractiveQuizData(timeline);
    if (!quizDatas.length) return;
    const quizRoot = await observeInteractiveQuiz(timeline, videoEl);
    if (!quizRoot) return;

    const quizItems = await wait.elements(
      null,
      SELECTORS.video.quizItemClass,
      quizRoot,
    );

    for (const [index, quizData] of quizDatas.entries()) {
      if (quizItems[index])
        await fillInteractiveQuiz(quizItems[index], quizData);
    }

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
    if (config.muteVideo) muteVideo(videoEl);

    const isStarted = await wait.until(() => {
      if (videoEl?.currentTime > 0 && !videoEl.paused) return true;
      launchBtn.click();
      return null;
    });
    if (!isStarted) throw new Error("视频多次尝试无法启动播放");

    if (config.lockingSpeed) applySpeed(videoEl, config.videoSpeedValue);
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

    const answersList = await tauriInvoke("solve_quiz", {
      html: quizDoc.documentElement.outerHTML,
    });
    await applyAnswers(quizList, answersList);

    if (config.debugTaskTypes.includes("Quiz")) {
      assert(
        await confirm(
          "[DEBUG] 答案已自动填充完成。点击[确定]继续提交，点击[取消]中断提交。",
        ),
        "调试中断：用户取消了 Quiz 提交",
      );
    }

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

    console.info("已自动填充AI生成的答案并确认提交");
  };

  /** @type {(chapterDoc: Document) => Promise<void>} */
  const handleTab = async (chapterDoc) => {
    const containers = await wait.elements(
      null,
      SELECTORS.taskPoint.containerSelector,
      chapterDoc,
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
        PDF: handlePDF,
        Quiz: handleQuiz, // 依赖tauriInvoke来AI答题
      };
      const type = classifyTask(taskDoc);
      await emit.taskProgress(index, type);
      const handler = taskHandler[type];
      const isFinished = container.classList.contains(
        SELECTORS.taskPoint.finishedClass,
      );
      if (isFinished && !config.debugTaskTypes.includes(type)) {
        console.info(`${taskInfo} 已完成，自动跳过`);
        continue;
      }

      await safeRun(
        () =>
          Promise.all([handler(taskDoc), wait.taskPointComplete(container)]),
        `${taskInfo} 处理异常，自动跳过，任务点类别：${type}`,
      );
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

  const preserveFocusState = () => {
    const blockedEvents = [
      "blur",
      "focusout",
      "mouseleave",
      "mouseout",
      "pagehide",
      "visibilitychange",
    ];

    // 1. 清理已有内联监听属性 (DOM Level 0)
    for (const evt of blockedEvents) {
      try {
        /** @type {any} */ (window)[`on${evt}`] = null;
        /** @type {any} */ (document)[`on${evt}`] = null;
      } catch (e) {
        console.error(`清理 ${evt} 事件监听失败:`, e);
      }
    }

    // 2. 捕获阶段强行掐断事件
    /** @param {Event} e */
    const stopPropagation = (e) => {
      e.stopImmediatePropagation();
      e.stopPropagation();
    };

    for (const evt of blockedEvents) {
      window.addEventListener(evt, stopPropagation, true);
      document.addEventListener(evt, stopPropagation, true);
    }

    // 3. 拦截后续动态 addEventListener
    const originalAdd = window.EventTarget.prototype.addEventListener;
    window.EventTarget.prototype.addEventListener = function (
      /** @type {string} */ type,
      /** @type {EventListenerOrEventListenerObject} */ listener,
      /** @type {any} */ options,
    ) {
      if (blockedEvents.includes(type)) return;
      return originalAdd.call(this, type, listener, options);
    };

    // 4. 伪造 Page Visibility 与 Focus API
    try {
      Object.defineProperty(document, "hidden", {
        get: () => false,
        configurable: true,
      });
      Object.defineProperty(document, "visibilityState", {
        get: () => "visible",
        configurable: true,
      });
      document.hasFocus = () => true;
    } catch (e) {
      console.error("伪造 Page Visibility 与 Focus API 失败:", e);
    }
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

    const speedInfo = config.lockingSpeed
      ? `${config.videoSpeedValue}x (已锁定)`
      : `${config.videoSpeedValue}x`;
    const configSummary = `当前配置：[视频倍速: ${speedInfo} | 自动静音: ${config.muteVideo ? "已开启" : "已关闭"}]`;

    const isConfirmed = await confirm(
      `[使用须知与运行指南 v2.1.4]
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
    preserveFocusState();
    await emit.started();

    do {
      await safeRun(() => handleCourse(totalChapterList()), "课程处理失败");
      await sleep(5000); // 懒得搞了反正除了粗糙点没啥太大的技术债，死循环算了
    } while (blockingCount(totalChapterList()) > 0);

    await emit.finished();
  };

  main();
})();

import { controller } from "@injected/chaoxing/safety.js";

/**
 * 等待指定毫秒数，可在给定百分比范围内随机浮动。
 * @param {number} ms 基准等待时间，单位毫秒。
 * @param {number} [fluctuationPercent=0] 上下浮动百分比。
 * @returns {Promise<void>}
 */
export const sleep = (ms, fluctuationPercent = 0) =>
  new Promise((resolve) =>
    window.setTimeout(
      resolve,
      ms * (1 + ((Math.random() * 2 - 1) * fluctuationPercent) / 100),
    ),
  );

/**
 * 条件为假时抛出带业务说明的错误。
 * @param {unknown} condition 要判断的值。
 * @param {string} message 错误说明。
 * @returns {asserts condition}
 */
export const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

/**
 * 读取已加载且非空的同源 iframe 文档；未就绪、未切换或无法访问时返回 null。
 * @param {HTMLIFrameElement|null} iframe 目标框架。
 * @param {Document|null} prevDoc 导航前的文档，用于排除旧页面。
 * @returns {Document|null}
 */
const getReadyIframeDoc = (iframe, prevDoc) => {
  try {
    const doc = iframe?.contentDocument;
    if (
      doc?.location?.href !== "about:blank" &&
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

/** 与平台无关的轮询和 DOM 等待操作。 */
export const wait = {
  /**
   * 轮询直到得到真值；超时返回 null。
   * @template T
   * @param {() => T|Promise<T>} getter 每次轮询执行的读取函数。
   * @param {number} [timeout=5000] 超时时间，单位毫秒。
   * @param {number} [interval=250] 轮询间隔，单位毫秒。
   * @returns {Promise<T|null>}
   */
  until: async (getter, timeout = 5000, interval = 250) => {
    const start = performance.now();
    while (performance.now() - start < timeout) {
      await controller.checkpoint();
      const value = await getter();
      if (value) return value;
      await sleep(interval);
    }
    return null;
  },
  /**
   * 执行前置操作后，等待非空元素列表；errorMsg=false 时超时返回空数组。
   * @param {(() => unknown)|null} preAction 等待前执行一次的操作。
   * @param {string} selector CSS 选择器。
   * @param {Document|Element} root 查询范围。
   * @param {string|false} [errorMsg] 自定义超时错误，false 表示不抛错。
   * @returns {Promise<HTMLElement[]>}
   */
  elements: async (preAction, selector, root, errorMsg = "") => {
    if (preAction) await preAction();
    const nodes = await wait.until(() => {
      const list = Array.from(root.querySelectorAll(selector));
      return list.length ? list : null;
    });
    if (errorMsg !== false)
      assert(nodes?.length, errorMsg || `等待 DOM 元素列表 [${selector}] 超时`);
    return /** @type {HTMLElement[]} */ (nodes ?? []);
  },
  /**
   * 执行前置操作后等待单个元素；errorMsg=false 时超时返回 null。
   * @param {(() => unknown)|null} preAction 等待前执行一次的操作。
   * @param {string} selector CSS 选择器。
   * @param {Document|Element} root 查询范围。
   * @param {string|false} [errorMsg] 自定义超时错误，false 表示不抛错。
   * @returns {Promise<HTMLElement|null>}
   */
  element: async (preAction, selector, root, errorMsg = "") => {
    if (preAction) await preAction();
    const node = await wait.until(() => root.querySelector(selector));
    if (errorMsg !== false)
      assert(node, errorMsg || `等待 DOM 节点 [${selector}] 超时`);
    return /** @type {HTMLElement|null} */ (node);
  },
  /**
   * 等待可访问且非空的框架文档；有前置操作时，排除操作前的旧文档。
   * @param {(() => unknown)|null} preAction 进入章节或切换页签的操作。
   * @param {string} selector iframe 选择器。
   * @param {Document|Element} root 查询范围。
   * @param {string|false} [errorMsg] 自定义超时错误，false 表示返回 null。
   * @returns {Promise<Document|null>}
   */
  iframeDoc: async (preAction, selector, root, errorMsg = "") => {
    let oldDoc = null;
    if (typeof preAction === "function") {
      oldDoc =
        /** @type {HTMLIFrameElement|null} */ (root.querySelector(selector))
          ?.contentDocument ?? null;
      await preAction();
    }

    const doc = await wait.until(() =>
      getReadyIframeDoc(
        /** @type {HTMLIFrameElement|null} */ (root.querySelector(selector)),
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
    return doc;
  },
};

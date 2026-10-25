import { config } from "@injected/chaoxing/runtime.js";
import { emit, safeRun } from "./runtime.js";
import { wait } from "@injected/utils/async.js";
import { handleChapter } from "@injected/chaoxing/course/chapter.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
import { TaskState, controller } from "@injected/chaoxing/safety.js";
/**
 * 获取课程目录中的章节节点，保持页面顺序。
 * @param {Document} document 课程主文档。
 * @returns {Element[]}
 */
export const chapterNodes = (document) => {
  const nodes = Array.from(
    document.querySelectorAll(SELECTORS.courseTree.nodeClass),
  );
  if (nodes.length > 0)
    console.info(`获取课程列表成功，共 ${nodes.length} 个章节`);
  else console.error("获取课程列表失败");

  return nodes;
};

/**
 * 根据目录节点的点击入口和完成标记判断状态。
 * @param {Element} node 课程目录节点。
 * @returns {"Title"|"Unknown"|"Blocking"|"Interactive"|"Finished"}
 */
export const chapterNodeStatus = (node) => {
  const nameSpan = /** @type {HTMLSpanElement|null} */ (
    node.querySelector(SELECTORS.courseTree.nameClass)
  );
  if (!nameSpan)
    return node.matches(SELECTORS.courseTree.titleSelector)
      ? "Title"
      : "Unknown";
  if (nameSpan.onclick == null) return "Blocking";
  return node.matches(SELECTORS.courseTree.unfinishedSelector)
    ? "Interactive"
    : "Finished";
};

/**
 * 普通模式处理未完成章节；调试模式也处理已完成章节。
 * @param {Element} node 章节节点。
 * @returns {boolean}
 */
export const shouldHandleChapter = (node) => {
  const status = chapterNodeStatus(node);
  return (
    status === "Interactive" ||
    (config.debugTaskTypes.length > 0 && status === "Finished")
  );
};

/**
 * 读取当前课程目录，排除纯标题和无法识别的节点。
 * @returns {Element[]}
 */
export const totalChapterList = () => {
  return chapterNodes(document).filter((node) => {
    const status = chapterNodeStatus(node);
    return (
      status === "Interactive" || status === "Finished" || status === "Blocking"
    );
  });
};

/**
 * 监听目录更新，返回新解锁且需要处理的章节，并从 blocking 中移除已解锁项。
 * @param {Element[]} blocking 尚未解锁的节点；此数组会被修改。
 * @returns {Promise<Element[]>} 新解锁节点；全部解锁但无需处理时为空数组。
 */
const unlockedChapters = (blocking) => {
  const check = () => {
    const unlocked = [];
    for (const original of blocking.slice()) {
      // 目录更新可能替换章节节点，按 ID 检查当前 DOM。
      const node = document.getElementById(original.id);
      if (!node) continue;
      const status = chapterNodeStatus(node);
      if (status !== "Interactive" && status !== "Finished") continue;
      blocking.splice(blocking.indexOf(original), 1);
      if (shouldHandleChapter(node)) unlocked.push(node);
    }
    return unlocked;
  };
  return new Promise((resolve) => {
    const observer = new MutationObserver(onChange);
    const timer = setInterval(() => {
      if (controller.state === TaskState.STOPPED) {
        cleanup();
        resolve([]);
      }
    }, 250);
    function cleanup() {
      clearInterval(timer);
      observer.disconnect();
    }
    function onChange() {
      if (controller.state === TaskState.STOPPED) {
        cleanup();
        resolve([]);
        return;
      }
      const unlocked = check();
      if (unlocked.length || blocking.length === 0) {
        cleanup();
        resolve(unlocked);
      }
    }
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "onclick"],
    });
    onChange();
  });
};

/**
 * 顺序处理可进入的章节，并在队尾追加随后解锁的章节。
 * @param {Element[]} chapterList 启动时的课程章节列表。
 * @returns {Promise<void>}
 */
export const handleCourse = async (chapterList) => {
  const pending = chapterList.filter(shouldHandleChapter);
  const blocking = chapterList.filter(
    (node) => chapterNodeStatus(node) === "Blocking",
  );

  for (const [index, original] of pending.entries()) {
    await controller.checkpoint();
    const node = await wait.element(null, `#${original.id}`, document);
    await emit.chapterProgress(index, node, totalChapterList());
    if (shouldHandleChapter(node)) {
      await safeRun(() => handleChapter(node), "章节处理失败，自动跳过该章节");
    }
    await controller.checkpoint();
    if (index === pending.length - 1 && blocking.length > 0) {
      console.info("等待锁定章节解锁");
      const unlocked = await unlockedChapters(blocking);
      await controller.checkpoint();
      pending.push(...unlocked);
    }
  }
};

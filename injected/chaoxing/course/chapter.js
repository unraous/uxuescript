import { emit, safeRun } from "@injected/chaoxing/course/runtime.js";
import { wait, assert } from "@injected/utils/async.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
import { handleTab } from "@injected/chaoxing/course/chapter/tasks.js";
import { studyContext } from "@injected/chaoxing/runtime.js";
/**
 * 进入章节并逐个切换页签，在每个页签中处理任务点。
 * @param {Element} node 课程目录中的章节节点。
 * @returns {Promise<void>}
 */
export const handleChapter = async (node) => {
  const nameSpan = /** @type {HTMLSpanElement|null} */ (
    node.querySelector(SELECTORS.courseTree.nameClass)
  );
  assert(nameSpan, "节点获取章节名称失败");
  studyContext.chapter =
    (nameSpan.getAttribute("title") || nameSpan.textContent).trim() || null;
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

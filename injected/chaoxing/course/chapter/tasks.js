import { config, cooldown } from "@injected/chaoxing/runtime.js";
import { emit, safeRun } from "@injected/chaoxing/course/runtime.js";
import { handleVideo } from "@injected/chaoxing/course/chapter/tasks/video.js";
import { handleAudio } from "@injected/chaoxing/course/chapter/tasks/audio.js";
import { handlePDF } from "@injected/chaoxing/course/chapter/tasks/pdf.js";
import { handleQuiz } from "@injected/chaoxing/course/chapter/tasks/quiz.js";
import { wait, assert } from "@injected/utils/async.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
import {
  TaskState,
  classifyTaskPolicy,
  controller,
} from "@injected/chaoxing/safety.js";
/**
 * @param {Document} taskDoc
 */
const classifyTask = (taskDoc) => {
  const url = taskDoc.location.href;
  if (url.includes(SELECTORS.urls.video)) return "Video";
  if (url.includes(SELECTORS.urls.audio)) return "Audio";
  if (url.includes(SELECTORS.urls.pdf)) return "PDF";
  if (url.includes(SELECTORS.urls.quiz)) return "Quiz";
  return "Other";
};

/** @type {Partial<Record<ReturnType<typeof classifyTask>, (document: Document) => Promise<void>>>} */
const handlers = {
  Video: handleVideo,
  Audio: handleAudio,
  PDF: handlePDF,
  Quiz: handleQuiz,
};

/**
 * 等待任务点容器出现平台完成标记；已完成或无容器时立即返回。
 * @param {Element|null} container 任务点外层容器。
 * @returns {Promise<boolean>}
 */
const taskPointComplete = (container) => {
  console.info("开始监控任务点完成情况");
  if (!container) return Promise.resolve(true);

  const isDone = () =>
    container.classList.contains(SELECTORS.taskPoint.finishedClass);
  if (isDone()) return Promise.resolve(true);

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (controller.state === TaskState.STOPPED) {
        cleanup();
        resolve(false);
        return;
      }
      if (isDone()) {
        cleanup();
        console.info("任务点在 DOM 中已更新为完成状态");
        resolve(true);
      }
    });
    const timer = setInterval(() => {
      if (controller.state === TaskState.STOPPED) {
        cleanup();
        resolve(false);
      }
    }, 250);
    function cleanup() {
      clearInterval(timer);
      observer.disconnect();
    }
    observer.observe(container, {
      attributes: true,
      attributeFilter: ["class"],
    });
  });
};

/**
 * 按框架 URL 分发当前页签的任务点，普通模式等待平台完成标记。
 * @param {Document} chapterDoc 页签对应的章节框架文档。
 * @returns {Promise<void>}
 */
export const handleTab = async (chapterDoc) => {
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
    await controller.checkpoint();
    const taskInfo = `第 ${index + 1}/${containers.length} 个任务点`;
    await wait.element(
      null,
      SELECTORS.taskPoint.iframeTag,
      container,
      "未找到任务点 iframe 节点",
    );
    const taskDoc = await wait.iframeDoc(
      null,
      SELECTORS.taskPoint.iframeTag,
      container,
      "获取任务文档失败，文档对象为空",
    );
    console.info(taskInfo);

    const type = classifyTask(taskDoc);
    if (debugging && !config.debugTaskTypes.includes(type)) continue;
    const classification = classifyTaskPolicy(type);
    console.info(`任务分类：${taskInfo}`, { type, classification });
    await emit.taskProgress(index, type);
    const handler = handlers[type];
    if (
      !debugging &&
      container.classList.contains(SELECTORS.taskPoint.finishedClass)
    ) {
      console.info(`${taskInfo} 已完成，自动跳过`);
      continue;
    }

    await cooldown();
    await controller.checkpoint();
    await safeRun(async () => {
      assert(handler, `未识别的任务点类型: ${taskDoc.location.href}`);
      if (type === "Quiz")
        assert(config.hasBackend, "未开启后端服务，无法处理Quiz任务点");

      await handler(taskDoc);
      if (!debugging) await taskPointComplete(container);
      await controller.checkpoint();
    }, `${taskInfo} 处理异常，自动跳过，任务点类别：${type}`);
  }
};

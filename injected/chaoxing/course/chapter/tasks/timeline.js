import { SELECTORS } from "@injected/chaoxing/selectors.js";
import { wait } from "@injected/utils/async.js";
import { TaskState, controller } from "@injected/chaoxing/safety.js";

/**
 * @typedef {import("./interactive.js").QuizData} QuizData
 * @typedef {{resourceId: number, description: string, startTime: number, endTime: number}} AnnotationData
 * @typedef {{style: string, datas: unknown[]}} TimelineObject
 * @typedef {{objects: TimelineObject[], validationUrl2: string}} TimelineComponent
 */

/**
 * 读取一次 Ext 时间轴，将互动题与批注数据交给各自的处理流程。
 * @param {Document} taskDoc
 */
export const getVideoTimelineData = async (taskDoc) => {
  const timeline = await wait.element(
    null,
    SELECTORS.video.timelineClass,
    taskDoc,
  );
  const videoWindow =
    /** @type {Window & {Ext?: {getCmp(id: string): TimelineComponent | undefined}}} */ (
      taskDoc.defaultView
    );
  const component = videoWindow?.Ext?.getCmp?.(timeline.id);
  const objects = component?.objects ?? [];
  const quizDatas = /** @type {QuizData[]} */ (
    structuredClone(
      objects
        .filter(({ style }) => style === "QUIZ" || style === "InteractiveQuiz")
        .flatMap(({ datas }) => datas ?? []),
    )
  );
  const annotationDatas = /** @type {AnnotationData[]} */ (
    structuredClone(
      objects
        .filter(({ style }) => style === "SyncAnnotationEvent")
        .flatMap(({ datas }) => datas ?? []),
    )
  ).sort((left, right) => left.startTime - right.startTime);
  return {
    timeline,
    quizDatas,
    annotationDatas,
    validationUrl2: component?.validationUrl2 ?? "",
  };
};

/**
 * 等待时间轴 DOM 变化满足条件；视频结束时停止等待并清理监听。
 * @template T
 * @param {HTMLElement} timeline
 * @param {HTMLVideoElement} videoEl
 * @param {() => T | null} read
 * @returns {Promise<T | null>}
 */
export const waitForTimeline = (timeline, videoEl, read) =>
  new Promise((resolve) => {
    const observer = new MutationObserver(check);
    const timer = setInterval(() => {
      if (controller.state === TaskState.STOPPED) finish(null);
    }, 250);
    function finish(result) {
      clearInterval(timer);
      observer.disconnect();
      videoEl.removeEventListener("ended", check);
      resolve(result);
    }
    function check() {
      if (controller.state === TaskState.STOPPED) {
        finish(null);
        return;
      }
      const result = videoEl.ended ? null : read();
      if (!result && !videoEl.ended) return;
      finish(result);
    }
    observer.observe(timeline, {
      childList: true,
      subtree: true,
    });
    videoEl.addEventListener("ended", check, { once: true });
    check();
  });

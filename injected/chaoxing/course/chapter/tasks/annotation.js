import { SELECTORS } from "@injected/chaoxing/selectors.js";
import { controller } from "@injected/chaoxing/safety.js";
import { waitForTimeline } from "./timeline.js";

/**
 * 按时间轴逐条等待批注，只点击“继续学习”；视频结束时忽略剩余批注。
 * @param {HTMLElement} timeline
 * @param {HTMLVideoElement} videoEl
 * @param {import("./timeline.js").AnnotationData[]} annotationDatas
 * @returns {Promise<void>}
 */
export const handleVideoAnnotations = async (
  timeline,
  videoEl,
  annotationDatas,
) => {
  console.info(`视频包含 ${annotationDatas.length} 条批注`);
  for (
    let index = 0;
    index < annotationDatas.length && !videoEl.ended;
    index++
  ) {
    const button = await waitForTimeline(
      timeline,
      videoEl,
      () =>
        /** @type {HTMLElement | null} */ (
          timeline.querySelector(SELECTORS.video.annotationContinueClass)
        ),
    );
    if (!button) break;
    await controller.checkpoint();
    button.click();
    console.info(
      `视频批注已点击继续学习（${index + 1}/${annotationDatas.length}）`,
    );
    const closed = await waitForTimeline(timeline, videoEl, () =>
      !timeline.contains(button) ? true : null,
    );
    if (!closed) break;
  }
};

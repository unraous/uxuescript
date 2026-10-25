import { config } from "@injected/chaoxing/runtime.js";
import { confirm } from "@injected/utils/backend.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
import { handleInteractiveQuiz } from "./interactive.js";
import { handleVideoAnnotations } from "./annotation.js";
import { getVideoTimelineData } from "./timeline.js";
import { muteVideo, applySpeed } from "./media.js";
import { wait, sleep, assert } from "@injected/utils/async.js";
import { controller } from "@injected/chaoxing/safety.js";

/**
 * 启动视频，应用静音和倍速配置，独立处理视频互动题与批注。
 * @param {Document} taskDoc 视频任务点文档。
 * @returns {Promise<void>}
 */
export const handleVideo = async (taskDoc) => {
  console.info("开始处理Video任务点");
  const launchBtn = await wait.element(
    null,
    SELECTORS.video.launchBtnClass,
    taskDoc,
    "未找到视频播放按钮",
  );
  const videoEl = /** @type {HTMLVideoElement} */ (
    await wait.element(null, SELECTORS.video.tag, taskDoc, "未找到视频播放控件")
  );
  if (config.muteVideo) muteVideo(videoEl);
  controller.setMedia(videoEl);

  const isStarted = await wait.until(() => {
    if (videoEl?.currentTime > 0 && !videoEl.paused) return true;
    launchBtn.click();
    return null;
  });
  if (!isStarted) throw new Error("视频多次尝试无法启动播放");

  if (config.lockSpeed != null) applySpeed(videoEl, config.lockSpeed);
  const { timeline, quizDatas, annotationDatas, validationUrl2 } =
    await getVideoTimelineData(taskDoc);
  await Promise.all([
    handleInteractiveQuiz(timeline, videoEl, quizDatas, validationUrl2),
    handleVideoAnnotations(timeline, videoEl, annotationDatas),
  ]);
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

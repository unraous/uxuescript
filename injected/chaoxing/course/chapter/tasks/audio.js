import { config } from "@injected/chaoxing/runtime.js";
import { confirm } from "@injected/utils/backend.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
import { muteVideo, applySpeed } from "./media.js";
import { wait, assert } from "@injected/utils/async.js";
import { controller } from "@injected/chaoxing/safety.js";

/**
 * 启动音频并等待时长就绪；不跳转结尾，完成标记由任务调度等待。
 * @param {Document} taskDoc 音频任务点文档。
 * @returns {Promise<void>}
 */
export const handleAudio = async (taskDoc) => {
  console.info("开始处理Audio任务点");
  const launchBtn = await wait.element(
    null,
    SELECTORS.audio.launchBtnClass,
    taskDoc,
    "未找到音频播放按钮",
  );
  const audioEl = /** @type {HTMLAudioElement} */ (
    await wait.element(null, SELECTORS.audio.tag, taskDoc, "未找到音频播放控件")
  );
  if (config.muteVideo) muteVideo(audioEl);
  controller.setMedia(audioEl);

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

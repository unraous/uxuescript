import { sleep } from "@injected/utils/async.js";
import { invoke } from "@injected/utils/backend.js";

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
    if (!invoke) {
      console.info("检测为无后端模式，使用默认配置");
      return;
    }
    try {
      console.info("正在从后端加载配置...");
      const res = await invoke("options");
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

/** 当前脚本上下文共享的运行配置。 */
export const config = new AppConfig();

/**
 * 按共享配置等待操作间隔；null 表示关闭，等待时间上下浮动 25%。
 * @returns {Promise<void>}
 */
export const cooldown = async () => {
  if (config.switchingCd != null) await sleep(config.switchingCd * 1000, 25);
};

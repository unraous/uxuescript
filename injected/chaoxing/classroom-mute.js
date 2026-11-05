import { muteVideo } from "@injected/chaoxing/course/chapter/tasks/media.js";
import { config } from "@injected/chaoxing/runtime.js";
import { invoke } from "@injected/utils/backend.js";

const finishedMessage = "uxue-classroom-replay-finished";
const muteRequest = "uxue-classroom-mute-request";
const muteMessage = "uxue-classroom-mute";

/** @param {() => void} mute */
const muteIfEnabled = async (mute) => {
  await config.loadFromBackend();
  if (config.muteVideo) mute();
};

/** 课堂回看页的播放器随页面加载，其他页面无需处理。 */
export function main() {
  if (window === window.top) {
    window.addEventListener("message", (event) => {
      if (event.data === finishedMessage) {
        invoke("return_from_task").catch((error) =>
          console.error("课堂回看结束后返回失败:", error),
        );
      } else if (event.data === muteRequest && event.source) {
        const source = /** @type {Window} */ (event.source);
        void muteIfEnabled(() => source.postMessage(muteMessage, event.origin));
      }
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    const video = document.querySelector("video#myVideo");
    if (video instanceof HTMLVideoElement) {
      if (window === window.top) {
        void muteIfEnabled(() => muteVideo(video));
      } else {
        window.addEventListener("message", (event) => {
          if (event.source === window.top && event.data === muteMessage)
            muteVideo(video);
        });
        window.top.postMessage(muteRequest, "*");
      }
      video.addEventListener(
        "ended",
        () => {
          window.top.postMessage(finishedMessage, "*");
        },
        { once: true },
      );
    }
  });
}

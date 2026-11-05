/** 降低并保持媒体音量。
 * @param {HTMLMediaElement} videoEl 音视频元素。
 * @returns {void}
 */
export const muteVideo = (videoEl) => {
  const apply = () => {
    // macOS WebView 最小化时，实测静音或零音量会卡住视频；此音量可继续播放。
    if (videoEl.volume !== 0.0001) videoEl.volume = 0.0001;
  };
  videoEl.addEventListener("volumechange", apply);
  apply();
};

/** 设置并锁定媒体播放倍速。
 * @param {HTMLMediaElement} videoEl 音视频元素。
 * @param {number} targetRate 目标倍速。
 * @returns {void}
 */
export const applySpeed = (videoEl, targetRate) => {
  videoEl.playbackRate = targetRate;
  Object.defineProperty(videoEl, "playbackRate", {
    get: () => targetRate,
    set: () => {},
    configurable: true,
  });
};

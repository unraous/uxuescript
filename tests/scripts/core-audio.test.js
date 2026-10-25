import { afterEach, describe, expect, it, vi } from "vitest";
import { config } from "@injected/chaoxing/runtime.js";
import { handleAudio } from "@injected/chaoxing/course/chapter/tasks/audio.js";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
/** @param {{duration?: number}} options */
function setup(options = {}) {
  vi.useFakeTimers();
  const error = vi.fn();
  Object.assign(config, {
    muteVideo: true,
    lockSpeed: null,
    debugTaskTypes: [],
  });
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = `
    <div id="audio"><audio class="vjs-tech"></audio>
      <button class="vjs-play-control">播放</button>
    </div>
    <audio id="audio1_html5_white"></audio>`;
  const audio = /** @type {HTMLAudioElement} */ (
    doc.querySelector("#audio audio")
  );
  let paused = true;
  let currentTime = 0;
  let duration = options.duration ?? 107;
  const seek = vi.fn((value) => {
    currentTime = value;
  });
  Object.defineProperties(audio, {
    paused: { get: () => paused },
    currentTime: { get: () => currentTime, set: seek },
    duration: { get: () => duration },
  });
  const click = vi
    .spyOn(doc.querySelector("button"), "click")
    .mockImplementation(() => {
      paused = !paused;
      // 播放先切换状态，下一轮媒体时间才开始推进。
      window.setTimeout(() => {
        currentTime = 1;
      }, 500);
    });
  return {
    config,
    doc,
    audio,
    seek,
    click,
    error,
    setDuration: /** @param {number} value */ (value) => {
      duration = value;
    },
  };
}
describe("standalone audio playback", () => {
  it("starts once, applies mute and speed without seeking to the end", async () => {
    const page = setup();
    page.config.lockSpeed = 2;
    const run = handleAudio(page.doc);
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    expect(page.click).toHaveBeenCalledOnce();
    expect(page.audio.muted).toBe(true);
    expect(page.audio.playbackRate).toBe(2);
    expect(page.seek).not.toHaveBeenCalled();
    expect(
      /** @type {HTMLAudioElement} */ (
        page.doc.querySelector("#audio1_html5_white")
      ).muted,
    ).toBe(false);
  });
  it("waits for media duration after playback starts without seeking", async () => {
    const page = setup({ duration: NaN });
    const run = handleAudio(page.doc);
    await vi.advanceTimersByTimeAsync(1000);
    expect(page.seek).not.toHaveBeenCalled();
    page.setDuration(406);
    await vi.advanceTimersByTimeAsync(250);
    await run;
    expect(page.seek).not.toHaveBeenCalled();
  });
  it("reports duration timeout through the existing error path", async () => {
    const page = setup({ duration: Infinity });
    const run = handleAudio(page.doc);
    const result = expect(run).rejects.toThrow("等待音频时长超时");
    await vi.advanceTimersByTimeAsync(6000);
    await result;
    expect(page.seek).not.toHaveBeenCalled();
  });
  it("does not seek before zero for subsecond audio", async () => {
    const page = setup({ duration: 0.5 });
    const run = handleAudio(page.doc);
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    expect(page.seek).not.toHaveBeenCalled();
  });
});

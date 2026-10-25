import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCore } from "../support/core";

afterEach(() => vi.useRealTimers());

function setup(options: { duration?: number } = {}) {
  vi.useFakeTimers();
  const error = vi.fn();
  const api = loadCore({ console: { info: vi.fn(), error } });
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = `
    <div id="audio"><audio class="vjs-tech"></audio>
      <button class="vjs-play-control">播放</button>
    </div>
    <audio id="audio1_html5_white"></audio>`;
  const audio = doc.querySelector("#audio audio") as HTMLAudioElement;
  let paused = true;
  let currentTime = 0;
  let duration = options.duration ?? 107;
  const seek = vi.fn((value: number) => {
    currentTime = value;
  });
  Object.defineProperties(audio, {
    paused: { get: () => paused },
    currentTime: { get: () => currentTime, set: seek },
    duration: { get: () => duration },
  });
  const click = vi.spyOn(doc.querySelector("button")!, "click")
    .mockImplementation(() => {
      paused = !paused;
      // 播放先切换状态，下一轮媒体时间才开始推进。
      window.setTimeout(() => { currentTime = 1; }, 500);
    });
  return {
    api, doc, audio, seek, click, error,
    setDuration: (value: number) => { duration = value; },
  };
}

describe("standalone audio playback", () => {
  it("starts once, applies mute and speed, and does not seek to the end", async () => {
    const page = setup();
    page.api.config.lockSpeed = 2;
    const run = page.api.handleAudio(page.doc);
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    expect(page.click).toHaveBeenCalledOnce();
    expect(page.audio.muted).toBe(true);
    expect(page.audio.playbackRate).toBe(2);
    expect(page.audio.paused).toBe(false);
    expect(page.seek).not.toHaveBeenCalled();
    expect((page.doc.querySelector("#audio1_html5_white") as HTMLAudioElement).muted)
      .toBe(false);
  });

  it("waits for media duration after playback starts without seeking", async () => {
    const page = setup({ duration: NaN });
    const run = page.api.handleAudio(page.doc);
    await vi.advanceTimersByTimeAsync(1000);
    expect(page.seek).not.toHaveBeenCalled();
    page.setDuration(406);
    await vi.advanceTimersByTimeAsync(250);
    await run;
    expect(page.audio.paused).toBe(false);
    expect(page.seek).not.toHaveBeenCalled();
  });

  it("reports duration timeout through the existing error path", async () => {
    const page = setup({ duration: Infinity });
    const run = page.api.handleAudio(page.doc);
    const result = expect(run).rejects.toThrow("等待音频时长超时");
    await vi.advanceTimersByTimeAsync(6000);
    await result;
    expect(page.seek).not.toHaveBeenCalled();
  });

  it("does not seek for subsecond audio", async () => {
    const page = setup({ duration: 0.5 });
    const run = page.api.handleAudio(page.doc);
    await vi.advanceTimersByTimeAsync(1000);
    await run;
    expect(page.audio.paused).toBe(false);
    expect(page.seek).not.toHaveBeenCalled();
  });

  it("stops while waiting for duration without seeking or continuing", async () => {
    const page = setup({ duration: NaN });
    const run = page.api.handleAudio(page.doc);
    await vi.advanceTimersByTimeAsync(1000);
    page.api.controller.stop();
    const stopped = expect(run).rejects.toThrow(/任务已停止/);
    await vi.advanceTimersByTimeAsync(250);
    await stopped;
    expect(page.seek).not.toHaveBeenCalled();
  });
});

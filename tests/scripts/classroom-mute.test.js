import { runInNewContext } from "node:vm";
import { flushPromises } from "@vue/test-utils";
import { expect, it, vi } from "vitest";
import { main } from "@injected/chaoxing/classroom-mute.js";
import { invoke } from "@injected/utils/backend.js";
import script from "../../dist/scripts/embedded/classroom-mute.js?raw";

const backend = vi.hoisted(() => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@injected/utils/backend.js", () => backend);

it("uses the configured mute setting and still returns after playback", async () => {
  backend.invoke.mockResolvedValue({ muteWebview: true });
  document.body.innerHTML = '<video id="myVideo"></video>';
  const video = document.querySelector("video");
  video.muted = true;
  video.defaultMuted = true;
  main();
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await flushPromises();
  expect(video.volume).toBe(0.0001);
  expect(video.muted).toBe(true);
  expect(video.defaultMuted).toBe(true);
  expect(Object.hasOwn(video, "muted")).toBe(false);
  expect(Object.hasOwn(video, "defaultMuted")).toBe(false);
  video.volume = 0.5;
  video.muted = false;
  video.defaultMuted = false;
  video.dispatchEvent(new Event("volumechange"));
  expect(video.volume).toBe(0.0001);
  expect(video.muted).toBe(false);
  expect(video.defaultMuted).toBe(false);
  video.muted = true;
  video.defaultMuted = true;
  video.dispatchEvent(new Event("volumechange"));
  expect(video.volume).toBe(0.0001);
  expect(video.muted).toBe(true);
  expect(video.defaultMuted).toBe(true);

  const frame = document.createElement("iframe");
  document.body.append(frame);
  const reply = vi.spyOn(frame.contentWindow, "postMessage");
  const request = () =>
    window.dispatchEvent(
      new MessageEvent("message", {
        data: "uxue-classroom-mute-request",
        source: frame.contentWindow,
        origin: "https://k.chaoxing.com",
      }),
    );
  request();
  await flushPromises();
  expect(reply).toHaveBeenCalledWith(
    "uxue-classroom-mute",
    "https://k.chaoxing.com",
  );

  backend.invoke.mockResolvedValue({ muteWebview: false });
  reply.mockClear();
  request();
  await flushPromises();
  expect(reply).not.toHaveBeenCalled();
  document.body.innerHTML = '<video id="myVideo"></video>';
  const unmuted = document.querySelector("video");
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await flushPromises();
  expect(unmuted.muted).toBe(false);
  expect(unmuted.volume).toBe(1);
  unmuted.volume = 0.5;
  unmuted.dispatchEvent(new Event("volumechange"));
  expect(unmuted.volume).toBe(0.5);

  const postMessage = vi.spyOn(window, "postMessage");
  unmuted.dispatchEvent(new Event("ended"));
  expect(postMessage).toHaveBeenCalledWith(
    "uxue-classroom-replay-finished",
    "*",
  );
  window.dispatchEvent(
    new MessageEvent("message", { data: "uxue-classroom-replay-finished" }),
  );
  expect(invoke).toHaveBeenCalledWith("return_from_task");
  postMessage.mockRestore();
  document.body.innerHTML = "";
});

it("applies the top frame's mute decision to a player in an iframe", () => {
  /** @type {Map<string, (event: {source: unknown, data: unknown}) => void>} */
  const listeners = new Map();
  const top = { postMessage: vi.fn() };
  const frame = {
    top,
    addEventListener: (
      /** @type {string} */ type,
      /** @type {(event: {source: unknown, data: unknown}) => void} */ listener,
    ) => listeners.set(type, listener),
  };
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = '<video id="myVideo"></video>';
  const video = doc.querySelector("video");
  runInNewContext(script, { window: frame, document: doc, HTMLVideoElement });
  doc.dispatchEvent(new Event("DOMContentLoaded"));
  expect(top.postMessage).toHaveBeenCalledWith(
    "uxue-classroom-mute-request",
    "*",
  );
  expect(video.muted).toBe(false);
  listeners.get("message")({ source: top, data: "uxue-classroom-mute" });
  expect(video.volume).toBe(0.0001);
  expect(video.muted).toBe(false);
});

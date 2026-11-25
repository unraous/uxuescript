import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { commands } from "@/services/cmds";
import TheChaoxingWebviewController from "@/components/TheChaoxingWebviewController.vue";

const mocks = vi.hoisted(() => ({
  currentWebview: vi.fn<typeof commands.currentWebview>(),
  canGoBack: vi.fn().mockResolvedValue(false),
  canGoForward: vi.fn().mockResolvedValue(false),
  currentUrl: vi.fn().mockResolvedValue("https://chaoxing.com/"),
  setZoom: vi.fn().mockResolvedValue(undefined),
  reload: vi.fn().mockResolvedValue(undefined),
  error: vi.fn().mockResolvedValue(undefined),
  unlisten: vi.fn(),
  urlChanged: undefined as undefined | (() => Promise<void>),
  changed: undefined as
    undefined | ((event: { payload: "chaoxing" | "deepseek" }) => void),
}));
vi.mock("@/services/cmds", () => ({ commands: mocks }));
vi.mock("@/services/errors", () => ({ showError: mocks.error }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event, callback) => {
    if (event === "active-webview-changed") mocks.changed = callback;
    if (event === "url-update")
      mocks.urlChanged = () => callback({ payload: "https://chaoxing.com/" });
    return mocks.unlisten;
  }),
}));
enableAutoUnmount(afterEach);
beforeEach(() => {
  mocks.currentWebview.mockResolvedValue("chaoxing");
});

it("keeps original course controls and removes the right-side switch buttons", async () => {
  const wrapper = mount(TheChaoxingWebviewController);
  await flushPromises();
  expect(wrapper.find(".view-switch").exists()).toBe(false);
  expect(wrapper.get(".title").text()).toBe("Course");
  await wrapper.get('[data-action="reload"]').trigger("click");
  expect(mocks.reload).toHaveBeenCalledOnce();
  await mocks.urlChanged?.();
  mocks.changed?.({ payload: "deepseek" });
  await flushPromises();
  expect(
    wrapper.get('[data-action="reload"]').attributes("disabled"),
  ).toBeDefined();
  mocks.changed?.({ payload: "chaoxing" });
  await flushPromises();
  expect(
    wrapper.get('[data-action="reload"]').attributes("disabled"),
  ).toBeUndefined();
  wrapper.unmount();
  expect(mocks.unlisten).toHaveBeenCalledTimes(2);
});

it("restores the real native view after remount without navigating it", async () => {
  mocks.currentWebview.mockResolvedValueOnce("deepseek");
  const wrapper = mount(TheChaoxingWebviewController);
  await flushPromises();
  expect(
    wrapper.get('[data-action="reload"]').attributes("disabled"),
  ).toBeDefined();
  expect(wrapper.get(".roll-in .url-text").text()).toBe("DeepSeek");
  expect(mocks.reload).not.toHaveBeenCalled();
});

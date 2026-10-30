import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import TheMaskPage from "@/TheMaskPage.vue";
import TheChaoxingMaskPage from "@/TheChaoxingMaskPage.vue";
import TheCourseProgressBar from "@/components/TheCourseProgressBar.vue";
import VRollTransition from "@/components/base/VRollTransition.vue";
import { commands } from "@/services/cmds";
import { emit, emitTo } from "@tauri-apps/api/event";

const events = vi.hoisted(
  () => new Map<string, (event?: { payload: unknown }) => void>(),
);
const timelineCompletions = vi.hoisted(() => [] as Array<() => void>);
const animationCompletions = vi.hoisted(() => [] as Array<() => void>);
const currentWebview = vi.hoisted(() => ({ label: "mask" }));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  emitTo: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    label: currentWebview.label,
    listen: vi.fn(async (name: string, callback: () => void) => {
      events.set(name, callback);
      return () => events.delete(name);
    }),
  }),
}));

vi.mock("@/services/cmds", () => ({
  commands: {
    general: vi.fn(async () => ({ labelLanguage: "en" })),
    showContent: vi.fn(async () => {}),
    hideMask: vi.fn(async () => {}),
    cancelUpdateDownload: vi.fn(async () => true),
  },
}));

const animations = vi.hoisted(() => ({
  timeline: vi.fn((options?: { onComplete?: () => void }) => {
    if (options?.onComplete) animationCompletions.push(options.onComplete);
    const timeline = {
      fromTo: vi.fn(),
      to: vi.fn(),
      then: vi.fn(
        <T>(callback?: () => T | PromiseLike<T>) =>
          new Promise<T | undefined>((resolve, reject) => {
            timelineCompletions.push(() => {
              try {
                resolve(callback?.());
              } catch (error) {
                reject(error);
              }
            });
          }),
      ),
      kill: vi.fn(),
    };
    timeline.fromTo.mockImplementation(() => timeline);
    timeline.to.mockImplementation(() => timeline);
    return timeline;
  }),
  to: vi.fn((_target?: unknown, _vars?: unknown) => ({ kill: vi.fn() })),
  killTweensOf: vi.fn(),
}));

vi.mock("gsap", () => ({ gsap: animations }));

afterEach(() => {
  vi.useRealTimers();
  events.clear();
  timelineCompletions.length = 0;
  animationCompletions.length = 0;
  currentWebview.label = "mask";
  vi.clearAllMocks();
});

describe("TheMaskPage", () => {
  it("shows a custom title and enables confirmation after the reading time", async () => {
    const wrapper = mount(TheChaoxingMaskPage);
    await flushPromises();
    vi.useFakeTimers();
    events.get("confirmation-pop-up")?.({
      payload: {
        message: "Read this",
        options: { title: "Notice", readSeconds: 2 },
      },
    });
    await nextTick();
    const dialog = wrapper.get('[role="dialog"]');
    expect(dialog.attributes("aria-label")).toBe("Notice");
    expect(dialog.get("h1").text()).toBe("Notice");
    const yes = dialog.findAll("button")[0];
    const countdown = dialog.get(".countdown");
    expect(yes.attributes("disabled")).toBeDefined();
    expect(yes.text()).toBe("Yes");
    expect(countdown.text()).toBe("2");
    expect(dialog.get(".message").classes()).toContain("custom-scrollbar");
    const timelines = animations.timeline.mock.results;
    const entrance = timelines[timelines.length - 1].value;
    const calls = entrance.fromTo.mock.calls;
    const reveal = calls[calls.length - 1] as unknown as [
      HTMLElement,
      { xPercent: number; visibility: string },
      {
        xPercent: number;
        duration: number;
        ease: string;
        onComplete: () => void;
      },
    ];
    expect(reveal[0]).toBe(countdown.get(".countdown-motion").element);
    expect(reveal[1].xPercent).toBe(100);
    expect(reveal[2].xPercent).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(countdown.text()).toBe("2");
    reveal[2].onComplete();
    await vi.advanceTimersByTimeAsync(1000);
    expect(countdown.getComponent(VRollTransition).props("value")).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(countdown.text()).toBe("1");
    await vi.advanceTimersByTimeAsync(700);
    expect(yes.attributes("disabled")).toBeUndefined();
    const exits = animations.to.mock.calls;
    const hide = exits[exits.length - 1][1] as {
      xPercent: number;
      duration: number;
      ease: string;
      onComplete: () => void;
    };
    expect(hide.xPercent).toBe(reveal[1].xPercent);
    expect(hide.duration).toBe(reveal[2].duration);
    expect(hide.ease).toBe(reveal[2].ease);
    hide.onComplete();
    await nextTick();
    expect(dialog.find(".countdown").exists()).toBe(false);
    await yes.trigger("click");
    animationCompletions.shift()?.();
    await nextTick();
    expect(emitTo).toHaveBeenCalledWith("mask", "confirmation-result", true);
    wrapper.unmount();
  });

  it("allows cancellation during the reading time", async () => {
    const wrapper = mount(TheChaoxingMaskPage);
    await flushPromises();
    vi.useFakeTimers();
    events.get("confirmation-pop-up")?.({
      payload: {
        message: "Read this",
        options: { title: null, readSeconds: 5 },
      },
    });
    await nextTick();
    const timelines = animations.timeline.mock.results;
    const entrance = timelines[timelines.length - 1].value;
    const calls = entrance.fromTo.mock.calls;
    const reveal = calls[calls.length - 1] as unknown as [
      unknown,
      unknown,
      { onComplete: () => void },
    ];
    reveal[2].onComplete();
    await wrapper.findAll("button")[1].trigger("click");
    animationCompletions.shift()?.();
    await nextTick();
    expect(emitTo).toHaveBeenCalledWith("mask", "confirmation-result", false);
    expect(vi.getTimerCount()).toBe(0);
    wrapper.unmount();
  });

  it.each([TheMaskPage, TheChaoxingMaskPage])(
    "uses the saved Chinese confirmation title",
    async (Page) => {
      vi.mocked(commands.general).mockResolvedValueOnce({
        labelLanguage: "zh",
      });
      const wrapper = mount(Page);
      await flushPromises();
      events.get("confirmation-pop-up")?.({
        payload: { message: "测试消息", options: null },
      });
      await flushPromises();
      const dialog = wrapper.get('[role="dialog"]');
      expect(dialog.get("h1").text()).toBe("确认");
      expect(dialog.attributes("aria-label")).toBe("确认");
      wrapper.unmount();
    },
  );

  it("shows a cancel-only updater dialog with the course progress bar", async () => {
    const wrapper = mount(TheMaskPage);
    await flushPromises();

    expect(emit).toHaveBeenCalledWith("mask-ready", {});
    expect(wrapper.find(".intro-mask").exists()).toBe(false);

    events.get("update-download-start")?.();
    await nextTick();
    const dialog = wrapper.find('[role="dialog"][aria-label="Downloading..."]');
    const buttons = wrapper.findAll("button");
    const progress = wrapper.findComponent(TheCourseProgressBar);
    expect(dialog.exists()).toBe(true);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].text()).toBe("取消");
    expect(progress.props("progress")).toBe(0);

    events.get("update-download-progress")?.({
      payload: { downloaded: 75, total: 100 },
    });
    await nextTick();
    expect(progress.props("progress")).toBe(75);
    expect(dialog.text()).toContain("75%");

    await buttons[0].trigger("click");
    expect(commands.cancelUpdateDownload).toHaveBeenCalledOnce();
    animationCompletions.shift()?.();
    await nextTick();
    expect(wrapper.find('[aria-label="Downloading..."]').exists()).toBe(false);
    expect(commands.hideMask).toHaveBeenCalledWith(false);
    wrapper.unmount();
  });

  it("keeps the task dialog open when the update download cannot be cancelled", async () => {
    vi.mocked(commands.cancelUpdateDownload).mockResolvedValueOnce(false);
    const wrapper = mount(TheMaskPage);
    await flushPromises();

    events.get("update-download-start")?.();
    await nextTick();
    await wrapper.find("button").trigger("click");

    expect(wrapper.find('[aria-label="Downloading..."]').exists()).toBe(true);
    expect(commands.hideMask).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("uses the same managed task dialog for the preview and hides it after cancellation", async () => {
    const wrapper = mount(TheMaskPage);
    await flushPromises();

    events.get("update-download-preview-start")?.();
    events.get("update-download-preview-progress")?.({ payload: 42 });
    await nextTick();
    expect(wrapper.find('[aria-label="Downloading..."]').text()).toContain(
      "42%",
    );

    await wrapper.find("button").trigger("click");
    animationCompletions.shift()?.();
    await nextTick();
    expect(emitTo).toHaveBeenCalledWith(
      "main",
      "update-download-preview-cancelled",
    );
    expect(wrapper.find('[aria-label="Downloading..."]').exists()).toBe(false);
    expect(commands.hideMask).toHaveBeenCalledWith(false);
    wrapper.unmount();
  });

  it("closes the download dialog when the exit animation starts and clears failed installs", async () => {
    const wrapper = mount(TheMaskPage);
    await flushPromises();

    events.get("update-download-start")?.();
    events.get("close-event")?.();
    await nextTick();

    expect(wrapper.find('[aria-label="Downloading..."]').exists()).toBe(false);
    expect(wrapper.find(".closing-mask").exists()).toBe(true);

    events.get("close-cancelled")?.();
    events.get("update-download-failed")?.();
    await nextTick();
    expect(wrapper.find(".closing-mask").exists()).toBe(false);
    expect(wrapper.find('[aria-label="Downloading..."]').exists()).toBe(false);
    expect(commands.hideMask).toHaveBeenCalledWith(false);
    wrapper.unmount();
  });

  it("mounts the intro for the start event and removes it after completion", async () => {
    let resolveShowContent: (value: null) => void = () => {};
    vi.mocked(commands.showContent).mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          resolveShowContent = resolve;
        }),
    );
    const wrapper = mount(TheMaskPage);
    await flushPromises();

    expect(commands.showContent).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith("mask-ready", {});
    expect(wrapper.findAll(".mask-layer")).toHaveLength(0);

    events.get("start-event")?.();
    await nextTick();

    expect(wrapper.find(".intro-mask").exists()).toBe(true);
    expect(animations.timeline).toHaveBeenCalledOnce();
    expect(commands.hideMask).not.toHaveBeenCalled();

    const timeline = animations.timeline.mock.results[0]?.value;
    expect(timeline.to).not.toHaveBeenCalled();
    timelineCompletions.shift()?.();
    await flushPromises();
    expect(commands.showContent).toHaveBeenCalledOnce();
    expect(timeline.to).not.toHaveBeenCalled();

    resolveShowContent(null);
    await flushPromises();
    expect(timeline.to).toHaveBeenCalledTimes(4);

    timelineCompletions.shift()?.();
    await flushPromises();

    expect(wrapper.find(".intro-mask").exists()).toBe(false);
    expect(commands.hideMask).toHaveBeenCalledWith(true);

    wrapper.unmount();
    expect(events.size).toBe(0);
  });

  it("stacks later animations above earlier ones and keeps the close layer", async () => {
    const wrapper = mount(TheMaskPage);
    await flushPromises();

    events.get("start-event")?.();
    events.get("close-event")?.();
    await nextTick();

    const layers = wrapper.findAll(".mask-layer");
    expect(layers).toHaveLength(2);
    expect(layers[0].find(".intro-mask").exists()).toBe(true);
    expect(layers[1].find(".closing-mask").exists()).toBe(true);
    expect(animations.to).toHaveBeenCalledOnce();

    timelineCompletions.shift()?.();
    await flushPromises();
    timelineCompletions.shift()?.();
    await flushPromises();

    expect(wrapper.findAll(".mask-layer")).toHaveLength(1);
    expect(wrapper.find(".closing-mask").exists()).toBe(true);

    wrapper.unmount();
  });

  it.each([
    ["main Yes", TheMaskPage, true],
    ["main No", TheMaskPage, false],
    ["chaoxing Yes", TheChaoxingMaskPage, true],
    ["chaoxing No", TheChaoxingMaskPage, false],
  ])(
    "shows a confirmation on %s and reports the choice after its exit animation",
    async (_name, Page, choice) => {
      currentWebview.label = _name.startsWith("chaoxing")
        ? "chaoxing-mask"
        : "mask";
      const wrapper = mount(Page);
      await flushPromises();
      expect(wrapper.findAll(".mask-layer")).toHaveLength(0);

      events.get("confirmation-pop-up")?.({
        payload: { message: "Continue?", options: null },
      });
      await nextTick();
      expect(wrapper.find('[role="dialog"]').text()).toContain("Continue?");
      expect(emitTo).not.toHaveBeenCalled();

      await wrapper.findAll("button")[choice ? 0 : 1].trigger("click");
      expect(emitTo).not.toHaveBeenCalled();
      animationCompletions.shift()?.();
      await nextTick();

      expect(emitTo).toHaveBeenCalledWith(
        currentWebview.label,
        "confirmation-result",
        choice,
      );
      expect(wrapper.findAll(".mask-layer")).toHaveLength(0);
      wrapper.unmount();
    },
  );

  it("dismisses the old Chaoxing confirmation on navigation and allows a new confirmation", async () => {
    currentWebview.label = "chaoxing-mask";
    const wrapper = mount(TheChaoxingMaskPage);
    await flushPromises();
    events.get("confirmation-pop-up")?.({
      payload: { message: "Old page", options: null },
    });
    await nextTick();
    expect(wrapper.find('[role="dialog"]').text()).toContain("Old page");

    events.get("confirmation-dismissed")?.();
    await nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(emitTo).toHaveBeenCalledExactlyOnceWith(
      "chaoxing-mask",
      "confirmation-result",
      false,
    );

    events.get("confirmation-pop-up")?.({
      payload: { message: "New page", options: null },
    });
    await nextTick();
    expect(wrapper.find('[role="dialog"]').text()).toContain("New page");
    await wrapper.findAll("button")[0].trigger("click");
    animationCompletions.shift()?.();
    await nextTick();
    expect(emitTo).toHaveBeenLastCalledWith(
      "chaoxing-mask",
      "confirmation-result",
      true,
    );
    wrapper.unmount();
    expect(events.size).toBe(0);
  });

  it("kills an unfinished confirmation exit animation when navigation dismisses it", async () => {
    currentWebview.label = "chaoxing-mask";
    const wrapper = mount(TheChaoxingMaskPage);
    await flushPromises();
    events.get("confirmation-pop-up")?.({
      payload: { message: "Old page", options: null },
    });
    await nextTick();
    await wrapper.findAll("button")[0].trigger("click");
    const results = animations.timeline.mock.results;
    const closing = results[results.length - 1]?.value;
    expect(emitTo).not.toHaveBeenCalled();

    events.get("confirmation-dismissed")?.();
    await nextTick();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(closing.kill).toHaveBeenCalledOnce();
    expect(emitTo).toHaveBeenCalledExactlyOnceWith(
      "chaoxing-mask",
      "confirmation-result",
      false,
    );
    wrapper.unmount();
  });

  it("does not send a cancellation result when navigation has no pending confirmation", async () => {
    currentWebview.label = "chaoxing-mask";
    const wrapper = mount(TheChaoxingMaskPage);
    await flushPromises();
    events.get("confirmation-dismissed")?.();
    await nextTick();
    expect(emitTo).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("keeps main-window confirmations independent of Chaoxing navigation", async () => {
    const wrapper = mount(TheMaskPage);
    await flushPromises();
    events.get("confirmation-pop-up")?.({
      payload: { message: "Main window", options: null },
    });
    await nextTick();
    expect(events.has("confirmation-dismissed")).toBe(false);
    expect(wrapper.find('[role="dialog"]').text()).toContain("Main window");
    expect(emitTo).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

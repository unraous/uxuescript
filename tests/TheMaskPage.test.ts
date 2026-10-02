import { flushPromises, mount } from "@vue/test-utils";
import { gsap } from "gsap";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import TheMaskPage from "@/TheMaskPage.vue";
import TheChaoxingMaskPage from "@/TheChaoxingMaskPage.vue";
import { commands } from "@/services/cmds";
import { emitTo } from "@tauri-apps/api/event";

const events = vi.hoisted(
  () => new Map<string, (event?: { payload: unknown }) => void>(),
);
const timelineCompletions = vi.hoisted(() => [] as Array<() => void>);
const animationCompletions = vi.hoisted(() => [] as Array<() => void>);
const currentWebview = vi.hoisted(() => ({ label: "mask" }));

vi.mock("@tauri-apps/api/event", () => ({
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
    showContent: vi.fn(async () => {}),
    startMask: vi.fn(async () => {}),
    hideMask: vi.fn(async () => {}),
  },
}));

vi.mock("gsap", () => ({
  gsap: {
    timeline: vi.fn((options?: { onComplete?: () => void }) => {
      if (options?.onComplete) animationCompletions.push(options.onComplete);
      const timeline = {
        fromTo: vi.fn(),
        to: vi.fn(),
        then: vi.fn(
          (callback?: () => unknown) =>
            new Promise<unknown>((resolve, reject) => {
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
    to: vi.fn(() => ({ kill: vi.fn() })),
    killTweensOf: vi.fn(),
  },
}));

afterEach(() => {
  events.clear();
  timelineCompletions.length = 0;
  animationCompletions.length = 0;
  currentWebview.label = "mask";
  vi.clearAllMocks();
});

describe("TheMaskPage", () => {
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
    expect(commands.startMask).toHaveBeenCalledOnce();
    expect(wrapper.findAll(".mask-layer")).toHaveLength(0);

    events.get("start-event")?.();
    await nextTick();

    expect(wrapper.find(".intro-mask").exists()).toBe(true);
    expect(gsap.timeline).toHaveBeenCalledOnce();
    expect(commands.hideMask).not.toHaveBeenCalled();

    const timeline = vi.mocked(gsap.timeline).mock.results[0]?.value;
    expect(vi.mocked(timeline.to)).not.toHaveBeenCalled();
    timelineCompletions.shift()?.();
    await flushPromises();
    expect(commands.showContent).toHaveBeenCalledOnce();
    expect(vi.mocked(timeline.to)).not.toHaveBeenCalled();

    resolveShowContent(null);
    await flushPromises();
    expect(vi.mocked(timeline.to)).toHaveBeenCalledTimes(4);

    timelineCompletions.shift()?.();
    await flushPromises();

    expect(wrapper.find(".intro-mask").exists()).toBe(false);
    expect(commands.hideMask).toHaveBeenCalledOnce();

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
    expect(gsap.to).toHaveBeenCalledOnce();

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
      currentWebview.label = _name.startsWith("chaoxing") ? "chaoxing-mask" : "mask";
      const wrapper = mount(Page);
      await flushPromises();
      expect(wrapper.findAll(".mask-layer")).toHaveLength(0);

      events.get("confirmation-pop-up")?.({
        payload: "Continue?",
      });
      await nextTick();
      expect(wrapper.find('[role="dialog"]').text()).toContain("Continue?");
      expect(emitTo).not.toHaveBeenCalled();

      await wrapper.findAll("button")[choice ? 0 : 1].trigger("click");
      expect(emitTo).not.toHaveBeenCalled();
      animationCompletions.shift()?.();
      await nextTick();

      expect(emitTo).toHaveBeenCalledWith(currentWebview.label, "confirmation-result", choice);
      expect(wrapper.findAll(".mask-layer")).toHaveLength(0);
      wrapper.unmount();
    },
  );
});

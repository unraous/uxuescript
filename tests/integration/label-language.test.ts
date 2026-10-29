import type { showError } from "@/services/errors";
import type { commands, GeneralConfig } from "@/services/cmds";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TheGeneralPanel from "@/components/TheConfigPanel/TheGeneralPanel.vue";
import TheCourseConfigPanel from "@/components/TheConfigPanel/TheCourseConfigPanel.vue";
import VSelector from "@/components/base/VSelector.vue";
import VButton from "@/components/base/VButton.vue";
import TheSidebar from "@/components/TheConfigPanel/TheSidebar.vue";
import { defineComponent, h } from "vue";
import { label, loadLabelLanguage, setLabelLanguage } from "@/labels";

const mocks = vi.hoisted(() => ({
  general: vi.fn<typeof commands.general>(),
  setGeneral: vi.fn<typeof commands.setGeneral>(),
  options: vi.fn<typeof commands.options>(),
  error: vi.fn<typeof showError>(),
}));
vi.mock("@/services/cmds", () => ({ commands: mocks }));
vi.mock("@/services/errors", () => ({ showError: mocks.error }));

beforeEach(async () => {
  let config: GeneralConfig = { labelLanguage: "en" };
  mocks.general.mockImplementation(async () => ({ ...config }));
  mocks.setGeneral.mockImplementation(async (next) => {
    config = { ...next };
  });
  mocks.options.mockResolvedValue({
    muteWebview: true,
    quizReview: false,
    lockSpeed: null,
    switchingCd: null,
  });
  await loadLabelLanguage();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("label language", () => {
  it("loads a saved language", async () => {
    mocks.general.mockResolvedValue({ labelLanguage: "zh" });
    await loadLabelLanguage();
    expect(label("provider")).toBe("模型供应商");
    expect(label("model")).toBe("模型");
  });

  it("switches labels through General while preserving other text", async () => {
    vi.useFakeTimers();
    const general = mount(TheGeneralPanel);
    const course = mount(TheCourseConfigPanel);
    await flushPromises();
    const selector = general.getComponent(VSelector);
    expect(selector.props("data").label).toBe("Language");
    expect(course.findAll("label").map((item) => item.text())).toEqual([
      "Mute Video",
      "Review Answers",
      "Speed Lock",
      "Delay",
    ]);
    const placeholders = course
      .findAll("input")
      .map((input) => input.attributes("placeholder"));
    const annotations = course
      .findAll("label")
      .map((item) => item.attributes("aria-describedby"));
    selector.props("methods").select(1);
    await flushPromises();
    expect(mocks.setGeneral).toHaveBeenLastCalledWith({ labelLanguage: "zh" });
    expect(selector.props("data").label).toBe("语言");
    expect(course.findAll(".label-roll .roll-in.roll-active")).toHaveLength(4);
    expect(
      course.findAll("label").map((item) => item.attributes("aria-label")),
    ).toEqual(["自动静音", "人工核验", "锁定倍速", "等待时间"]);
    await vi.advanceTimersByTimeAsync(300);
    expect(course.findAll("label").map((item) => item.text())).toEqual([
      "自动静音",
      "人工核验",
      "锁定倍速",
      "等待时间",
    ]);
    expect(
      course.findAll("input").map((input) => input.attributes("placeholder")),
    ).toEqual(placeholders);
    expect(
      course
        .findAll("label")
        .map((item) => item.attributes("aria-describedby")),
    ).toEqual(annotations);
    selector.props("methods").select(0);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(300);
    expect(label("lockPlayspeed")).toBe("Speed Lock");
    general.unmount();
    course.unmount();
  });

  it("keeps request settings when changing language and preserves language when editing settings", async () => {
    let config = {
      labelLanguage: "en" as "en" | "zh",
      concurrency: 3,
      batchSize: 4,
    };
    mocks.general.mockImplementation(async () => ({ ...config }));
    mocks.setGeneral.mockImplementation(async (next) => {
      config = {
        labelLanguage: next.labelLanguage ?? "en",
        concurrency: next.concurrency ?? 10,
        batchSize: next.batchSize ?? 5,
      };
    });
    const general = mount(TheGeneralPanel);
    await flushPromises();
    expect(
      general.get<HTMLInputElement>("#model-concurrency").element.value,
    ).toBe("3");
    expect(
      general.get<HTMLInputElement>("#model-batch-size").element.value,
    ).toBe("4");
    await setLabelLanguage("zh");
    expect(config).toEqual({
      labelLanguage: "zh",
      concurrency: 3,
      batchSize: 4,
    });
    await general.get("#model-concurrency").setValue("2");
    await flushPromises();
    await general.get("#model-batch-size").setValue("6");
    await flushPromises();
    expect(config).toEqual({
      labelLanguage: "zh",
      concurrency: 2,
      batchSize: 6,
    });
    mocks.setGeneral.mockClear();
    for (const [id, savedValue] of [
      ["model-concurrency", "2"],
      ["model-batch-size", "6"],
    ]) {
      const input = general.get<HTMLInputElement>(`#${id}`);
      for (const value of ["", "0", "4294967296"]) {
        await input.setValue(value);
        await flushPromises();
        expect(input.element.value).toBe(savedValue);
      }
    }
    expect(mocks.setGeneral).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
    await general.get("#model-concurrency").setValue("4294967295");
    await flushPromises();
    expect(config.concurrency).toBe(4294967295);
    mocks.setGeneral.mockRejectedValueOnce(new Error("failed"));
    await general.get("#model-batch-size").setValue("7");
    await flushPromises();
    expect(
      general.get<HTMLInputElement>("#model-batch-size").element.value,
    ).toBe("6");
    general.unmount();
  });

  it("filters non-integer text while typing and permits clearing before replacement", async () => {
    const wrapper = mount(TheGeneralPanel);
    await flushPromises();
    for (const [id, initial] of [
      ["model-concurrency", "10"],
      ["model-batch-size", "5"],
    ]) {
      const input = wrapper.get<HTMLInputElement>(`#${id}`);
      for (const value of [" ", "-1", "1.5", "abc", "Infinity"]) {
        input.element.value = value;
        await input.trigger("input");
        expect(input.element.value).toBe(initial);
      }
      input.element.value = "";
      await input.trigger("input");
      expect(input.element.value).toBe("");
      input.element.value = "12";
      await input.trigger("input");
      expect(input.element.value).toBe("12");
    }
    expect(mocks.setGeneral).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("keeps the current language when saving fails", async () => {
    mocks.setGeneral.mockRejectedValueOnce(new Error("failed"));
    await expect(setLabelLanguage("zh")).rejects.toThrow("failed");
    expect(label("provider")).toBe("Provider");
  });

  it("rolls button and sidebar text without replacing tabs or changing their selection", async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h("div", [
            h(TheSidebar, {
              modelValue: 1,
              items: (
                ["tabApi", "tabCourse", "tabTheme", "tabGeneral"] as const
              ).map((key) => ({ name: label(key) })),
            }),
            h(VButton, { label: label("save"), onClick: save }),
          ]),
      }),
    );
    const tabs = wrapper.findAll('[role="tab"]');
    const firstTab = tabs[0].element;
    expect(tabs.map((tab) => tab.text())).toEqual([
      "API",
      "Course",
      "Theme",
      "General",
    ]);
    await setLabelLanguage("zh");
    await flushPromises();
    expect(wrapper.findAll(".menu-text .roll-in.roll-active")).toHaveLength(4);
    expect(wrapper.find(".base-button .roll-in.roll-active").exists()).toBe(
      true,
    );
    expect(wrapper.get(".base-button").attributes("aria-label")).toBe("保存");
    await vi.advanceTimersByTimeAsync(300);
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual([
      "模型",
      "课程",
      "主题",
      "通用",
    ]);
    expect(wrapper.findAll('[role="tab"]')[0].element).toBe(firstTab);
    expect(wrapper.findAll('[role="tab"]')[1].attributes("aria-selected")).toBe(
      "true",
    );
    expect(wrapper.get(".base-button").text()).toBe("保存");
    await wrapper.get(".base-button").trigger("click");
    expect(save).toHaveBeenCalledOnce();
    await setLabelLanguage("en");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(300);
    expect(wrapper.get(".base-button").text()).toBe("Save");
    expect(wrapper.findAll('[role="tab"]')[1].text()).toBe("Course");
    wrapper.unmount();
  });
});

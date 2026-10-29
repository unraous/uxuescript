import type { showError } from "@/services/errors";
import type { commands, OptionsConfig } from "@/services/cmds";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TheCourseConfigPanel from "@/components/TheConfigPanel/TheCourseConfigPanel.vue";

const mocks = vi.hoisted(() => ({
  options: vi.fn<typeof commands.options>(),
  setOptions: vi.fn<typeof commands.setOptions>(),
  error: vi.fn<typeof showError>(),
}));
vi.mock("@/services/cmds", () => ({ commands: mocks }));
vi.mock("@/services/errors", () => ({ showError: mocks.error }));

beforeEach(() => {
  let config: OptionsConfig = {
    muteWebview: true,
    quizReview: false,
    lockSpeed: 2,
    switchingCd: 3,
  };
  mocks.options.mockImplementation(async () => ({ ...config }));
  mocks.setOptions.mockImplementation(async (next) => {
    config = { ...next };
  });
  mocks.error.mockResolvedValue(undefined);
});

describe("optional course settings", () => {
  it("enables and disables manual quiz review", async () => {
    const wrapper = mount(TheCourseConfigPanel);
    await flushPromises();
    const toggle = wrapper.get("#quiz-review-toggle");
    expect(toggle.attributes("aria-checked")).toBe("false");
    await toggle.trigger("click");
    await flushPromises();
    expect(mocks.setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ quizReview: true }),
    );
    await toggle.trigger("click");
    await flushPromises();
    expect(mocks.setOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ quizReview: false }),
    );
    wrapper.unmount();
  });
  it("loads, updates and clears both numeric settings", async () => {
    const wrapper = mount(TheCourseConfigPanel);
    await flushPromises();
    for (const [id, key, initial] of [
      ["playing-speed-input", "lockSpeed", "2"],
      ["switching-cd-input", "switchingCd", "3"],
    ]) {
      const input = wrapper.get<HTMLInputElement>(`#${id}`);
      expect(input.element.value).toBe(initial);
      await input.setValue("1.5");
      await flushPromises();
      expect(input.element.value).toBe("1.5");
      expect(mocks.setOptions).toHaveBeenLastCalledWith(
        expect.objectContaining({ [key]: 1.5 }),
      );
      await input.setValue("");
      await flushPromises();
      expect(input.element.value).toBe("");
      expect(mocks.setOptions).toHaveBeenLastCalledWith(
        expect.objectContaining({ [key]: null }),
      );
    }
    wrapper.unmount();
  });

  it("rejects zero when committing the value", async () => {
    const wrapper = mount(TheCourseConfigPanel);
    await flushPromises();
    await wrapper.get("#switching-cd-input").setValue("0");
    await flushPromises();
    expect(
      wrapper.get<HTMLInputElement>("#switching-cd-input").element.value,
    ).toBe("3");
    expect(mocks.setOptions).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("filters invalid text while permitting partial decimals during editing", async () => {
    const wrapper = mount(TheCourseConfigPanel);
    await flushPromises();
    for (const [id, initial] of [
      ["playing-speed-input", "2"],
      ["switching-cd-input", "3"],
    ]) {
      const input = wrapper.get<HTMLInputElement>(`#${id}`);
      for (const value of ["-1", "abc", "1.2.3"]) {
        input.element.value = value;
        await input.trigger("input");
        expect(input.element.value).toBe(initial);
      }
      for (const value of ["", "0", "0.", "0.5"]) {
        input.element.value = value;
        await input.trigger("input");
        expect(input.element.value).toBe(value);
      }
    }
    expect(mocks.setOptions).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("restores rejected numbers and toggles before the error dialog closes", async () => {
    let dismiss!: () => void;
    mocks.error.mockReturnValue(
      new Promise<void>((resolve) => {
        dismiss = resolve;
      }),
    );
    const wrapper = mount(TheCourseConfigPanel);
    await flushPromises();
    const input = wrapper.get<HTMLInputElement>("#playing-speed-input");
    mocks.setOptions.mockRejectedValueOnce(new Error("failed"));
    await input.setValue("4");
    await flushPromises();
    expect(input.element.value).toBe("2");
    mocks.setOptions.mockRejectedValueOnce(new Error("failed"));
    const toggle = wrapper.get("#quiz-review-toggle");
    await toggle.trigger("click");
    await flushPromises();
    expect(toggle.attributes("aria-checked")).toBe("false");
    expect(mocks.error).toHaveBeenCalledTimes(2);
    dismiss();
    wrapper.unmount();
  });
});

import type { commands, LLMProvider, SolverKind } from "@/services/cmds";
import type { showError } from "@/services/errors";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TheConfigPanel from "@/components/TheConfigPanel.vue";
import TheAPIPanel from "@/components/TheConfigPanel/TheAPIPanel.vue";
import VSelector from "@/components/base/VSelector.vue";
import { loadLabelLanguage, setLabelLanguage } from "@/labels";

const mocks = vi.hoisted(() => ({
  currentSolver: vi.fn<typeof commands.currentSolver>(),
  setSolver: vi.fn<typeof commands.setSolver>(),
  providers: vi.fn<typeof commands.providers>(),
  currentProvider: vi.fn<typeof commands.currentProvider>(),
  switchModel: vi.fn<typeof commands.switchModel>(),
  switchProvider: vi.fn<typeof commands.switchProvider>(),
  upsertProvider: vi.fn<typeof commands.upsertProvider>(),
  setKey: vi.fn<typeof commands.setKey>(),
  healthy: vi.fn<typeof commands.healthy>(),
  confirm: vi.fn<typeof commands.confirm>(),
  saveConfig: vi.fn<typeof commands.saveConfig>(),
  general: vi.fn<typeof commands.general>(),
  setGeneral: vi.fn<typeof commands.setGeneral>(),
  error: vi.fn<typeof showError>(),
}));
vi.mock("@/services/cmds", () => ({ commands: mocks }));
vi.mock("@/services/errors", () => ({ showError: mocks.error }));
enableAutoUnmount(afterEach);

const mountConfig = () =>
  mount(TheConfigPanel, {
    global: {
      stubs: {
        TheCourseConfigPanel: true,
        TheThemePanel: true,
        TheGeneralPanel: true,
      },
    },
  });

beforeEach(async () => {
  let solver: SolverKind = "native_llm";
  let provider: LLMProvider = {
    name: "Saved Provider",
    isCustom: true,
    protocol: "OpenAIChatCompletions",
    baseUrl: "https://example.com/chat/completions",
    apiKey: "saved-api-key",
    models: ["first-model", "saved-model"],
    chosenModel: 1,
  };
  mocks.currentSolver.mockImplementation(async () => solver);
  mocks.setSolver.mockImplementation(async (kind) => {
    solver = kind;
  });
  mocks.providers.mockImplementation(async () => [structuredClone(provider)]);
  mocks.currentProvider.mockResolvedValue("Saved Provider");
  mocks.switchModel.mockImplementation(async (index) => {
    provider.chosenModel = index;
  });
  mocks.upsertProvider.mockImplementation(async (value) => {
    provider = { ...value, models: [...value.models] };
    return null;
  });
  mocks.setKey.mockImplementation(async (key) => {
    provider.apiKey = key;
    return null;
  });
  mocks.healthy.mockResolvedValue("ok");
  mocks.confirm.mockResolvedValue(true);
  mocks.general.mockResolvedValue({ labelLanguage: "en" });
  mocks.error.mockResolvedValue(undefined);
  await loadLabelLanguage();
});

describe("solver configuration", () => {
  it("extends the first category and keeps the Native API controls", async () => {
    const wrapper = mountConfig();
    await flushPromises();
    expect(wrapper.get("#config-tab-0").attributes("aria-label")).toBe(
      "Solver",
    );
    const selector = wrapper.getComponent<typeof VSelector>(".solver-selector");
    expect(selector.props("data")).toMatchObject({
      label: "Solver",
      selectedIndex: 0,
      mutable: false,
      items: [
        { label: "Native LLM", mutable: false },
        { label: "DeepSeek Web", mutable: false },
      ],
    });
    const api = wrapper.getComponent(TheAPIPanel);
    expect(
      api.findAllComponents(VSelector).map((item) => item.props("data").label),
    ).toEqual(["Provider", "Model"]);
    expect(
      api
        .get('input[placeholder="https://api.example.com/v1/chat/completions"]')
        .attributes("disabled"),
    ).toBeUndefined();
    expect(api.find('input[placeholder="Enter API key"]').exists()).toBe(true);
    await api.get('[aria-label="Test Connection"]').trigger("click");
    await flushPromises();
    expect(mocks.healthy).toHaveBeenCalledOnce();
    expect(mocks.confirm).toHaveBeenCalledOnce();
  });

  it("updates runtime selection without saving or changing Native settings", async () => {
    const wrapper = mountConfig();
    await flushPromises();
    const before = await mocks.providers();
    await wrapper.get(".solver-selector .select-trigger").trigger("click");
    const choices = wrapper.findAll(".solver-selector .option-label");
    expect(choices.map((choice) => choice.text())).toEqual([
      "Native LLM",
      "DeepSeek Web",
    ]);
    await choices[1].trigger("click");
    await flushPromises();
    expect(mocks.setSolver).toHaveBeenCalledWith("deep_seek_web");
    expect(await mocks.currentSolver()).toBe("deep_seek_web");
    expect(wrapper.findComponent(TheAPIPanel).exists()).toBe(false);
    expect(wrapper.get(".web-solver-notice").text()).toBe(
      "DeepSeek Web is not connected yet.",
    );
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    expect(mocks.healthy).not.toHaveBeenCalled();
    expect(mocks.switchProvider).not.toHaveBeenCalled();
    expect(mocks.switchModel).not.toHaveBeenCalled();
    expect(mocks.upsertProvider).not.toHaveBeenCalled();
    expect(mocks.setKey).not.toHaveBeenCalled();
    expect(await mocks.providers()).toEqual(before);
    expect(await mocks.currentProvider()).toBe("Saved Provider");
    await wrapper.get('.save-button [aria-label="Save"]').trigger("click");
    expect(mocks.saveConfig).toHaveBeenCalledOnce();
  });

  it("restores the Web selection on remount and preserves edited Native settings when switching back", async () => {
    const wrapper = mountConfig();
    await flushPromises();
    const api = wrapper.getComponent(TheAPIPanel);
    api.findAllComponents(VSelector)[1].props("methods").select(0);
    await flushPromises();
    await api
      .get('input[placeholder="https://api.example.com/v1/chat/completions"]')
      .setValue("https://changed.example.com/v1/chat/completions");
    await flushPromises();
    expect(mocks.error.mock.calls).toEqual([]);
    const key = api.get('input[placeholder="Enter API key"]');
    await key.trigger("focus");
    await key.setValue("changed-api-key");
    await flushPromises();
    const native = await mocks.providers();
    wrapper
      .getComponent<typeof VSelector>(".solver-selector")
      .props("methods")
      .select(1);
    await flushPromises();
    wrapper.unmount();

    const restored = mountConfig();
    await flushPromises();
    expect(
      restored.getComponent<typeof VSelector>(".solver-selector").props("data")
        .selectedIndex,
    ).toBe(1);
    expect(restored.findComponent(TheAPIPanel).exists()).toBe(false);
    restored
      .getComponent<typeof VSelector>(".solver-selector")
      .props("methods")
      .select(0);
    await flushPromises();
    const nativePanel = restored.getComponent(TheAPIPanel);
    expect(
      nativePanel.findAllComponents(VSelector)[1].props("data").selectedIndex,
    ).toBe(0);
    expect(
      nativePanel.get<HTMLInputElement>(
        'input[placeholder="https://api.example.com/v1/chat/completions"]',
      ).element.value,
    ).toBe("https://changed.example.com/v1/chat/completions");
    const restoredKey = nativePanel.get<HTMLInputElement>(
      'input[placeholder="Enter API key"]',
    );
    await restoredKey.trigger("focus");
    expect(restoredKey.element.value).toBe("changed-api-key");
    expect(await mocks.providers()).toEqual(native);
    expect(await mocks.currentSolver()).toBe("native_llm");
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it("keeps the runtime choice and Native panel when the update command fails", async () => {
    mocks.setSolver.mockRejectedValueOnce(new Error("IPC failed"));
    const wrapper = mountConfig();
    await flushPromises();
    wrapper
      .getComponent<typeof VSelector>(".solver-selector")
      .props("methods")
      .select(1);
    await flushPromises();
    expect(
      wrapper.getComponent<typeof VSelector>(".solver-selector").props("data")
        .selectedIndex,
    ).toBe(0);
    expect(wrapper.findComponent(TheAPIPanel).exists()).toBe(true);
    expect(await mocks.currentSolver()).toBe("native_llm");
    expect(mocks.error).toHaveBeenCalledWith(
      "求解方式配置命令执行失败:",
      expect.any(Error),
    );
    expect(mocks.saveConfig).not.toHaveBeenCalled();
  });

  it("uses the existing bilingual labels for the category and Web notice", async () => {
    mocks.currentSolver.mockResolvedValue("deep_seek_web");
    const wrapper = mountConfig();
    await flushPromises();
    await setLabelLanguage("zh");
    await flushPromises();
    expect(wrapper.get("#config-tab-0").attributes("aria-label")).toBe(
      "求解方式",
    );
    expect(
      wrapper.getComponent<typeof VSelector>(".solver-selector").props("data")
        .label,
    ).toBe("求解方式");
    expect(wrapper.get(".web-solver-notice").text()).toBe(
      "DeepSeek Web 功能尚未接通。",
    );
  });
});

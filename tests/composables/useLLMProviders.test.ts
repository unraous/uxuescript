import type { commands } from "@/services/cmds";
import { defineComponent } from "vue";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLLMProviders } from "@/composables/useLLMProviders";
import type { LLMProvider } from "@/services/cmds";

const commandMocks = vi.hoisted(() => ({
  providers: vi.fn<typeof commands.providers>(),
  currentProvider: vi.fn<typeof commands.currentProvider>(),
  upsertProvider: vi.fn<typeof commands.upsertProvider>(),
  switchProvider: vi.fn<typeof commands.switchProvider>(),
  removeProvider: vi.fn<typeof commands.removeProvider>(),
  switchModel: vi.fn<typeof commands.switchModel>(),
}));

vi.mock("@/services/cmds", () => ({ commands: commandMocks }));

function makeProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    name: "Default",
    isCustom: false,
    protocol: "OpenAIChatCompletions",
    baseUrl: "https://api.example.com/v1",
    models: ["default-model"],
    chosenModel: 0,
    hasKey: false,
    ...overrides,
  };
}

enableAutoUnmount(afterEach);

async function mountComposable() {
  let state!: ReturnType<typeof useLLMProviders>;
  mount(
    defineComponent({
      setup() {
        state = useLLMProviders();
        return {};
      },
      template: "<div />",
    }),
  );

  await flushPromises();
  return state;
}

beforeEach(() => {
  commandMocks.providers.mockResolvedValue([]);
  commandMocks.currentProvider.mockResolvedValue("");
  commandMocks.upsertProvider.mockResolvedValue(null);
  commandMocks.switchProvider.mockResolvedValue(null);
  commandMocks.removeProvider.mockResolvedValue(null);
  commandMocks.switchModel.mockResolvedValue(undefined);
});

describe("useLLMProviders", () => {
  it("loads providers and derives the active provider and model data", async () => {
    const defaultProvider = makeProvider();
    const customProvider = makeProvider({
      name: "Custom",
      isCustom: true,
      models: ["custom-model"],
    });
    commandMocks.providers.mockResolvedValue([defaultProvider, customProvider]);
    commandMocks.currentProvider.mockResolvedValue("Custom");

    const state = await mountComposable();

    expect(state.selectedProvider.value).toEqual(customProvider);
    expect(state.providerData.value.items).toEqual([
      { label: "Default", mutable: false },
      { label: "Custom", mutable: true },
    ]);
    expect(state.modelData.value).toMatchObject({
      selectedIndex: 0,
      mutable: true,
      items: [{ label: "custom-model", mutable: true }],
    });
  });

  it("restores a built-in provider when the stored ID differs only by case", async () => {
    const defaultProvider = makeProvider({ name: "BigModel" });
    const deepSeekProvider = makeProvider({ name: "DeepSeek" });
    commandMocks.providers.mockResolvedValue([
      defaultProvider,
      deepSeekProvider,
    ]);
    commandMocks.currentProvider.mockResolvedValue("deepseek");

    const state = await mountComposable();

    expect(state.selectedProvider.value).toEqual(deepSeekProvider);
  });

  it("trims and persists a new provider before selecting it", async () => {
    const defaultProvider = makeProvider();
    commandMocks.providers.mockResolvedValue([defaultProvider]);
    commandMocks.currentProvider.mockResolvedValue("Default");

    const state = await mountComposable();

    await state.addProvider("  Custom  ");

    expect(commandMocks.upsertProvider).toHaveBeenCalledWith({
      name: "Custom",
      isCustom: true,
      protocol: "OpenAIChatCompletions",
      baseUrl: "https://api.example.com/v1",
      models: [],
      chosenModel: null,
      hasKey: false,
    });
    expect(commandMocks.switchProvider).toHaveBeenCalledWith("Custom");
    expect(state.selectedProvider.value?.name).toBe("Custom");
  });

  it("keeps the chosen model index consistent when deleting a model", async () => {
    const provider = makeProvider({
      name: "Custom",
      isCustom: true,
      models: ["first", "second", "third"],
      chosenModel: 2,
    });
    commandMocks.providers.mockResolvedValue([provider]);
    commandMocks.currentProvider.mockResolvedValue("Custom");

    const state = await mountComposable();

    await state.deleteModel(1);

    expect(state.selectedProvider.value?.models).toEqual(["first", "third"]);
    expect(state.selectedProvider.value?.chosenModel).toBe(1);
    expect(commandMocks.upsertProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Custom",
        models: ["first", "third"],
        chosenModel: 1,
      }),
    );
  });
});

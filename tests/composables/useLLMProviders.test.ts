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
  error: vi.fn(),
}));

vi.mock("@/services/cmds", () => ({ commands: commandMocks }));
vi.mock("@/services/errors", () => ({ showError: commandMocks.error }));

function makeProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    name: "Default",
    isCustom: false,
    protocol: "OpenAIChatCompletions",
    baseUrl: "https://api.example.com/v1",
    apiKey: null,
    models: ["default-model"],
    chosenModel: 0,
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

let storedProviders: LLMProvider[];
let activeProvider: string;

beforeEach(() => {
  storedProviders = [];
  activeProvider = "";
  commandMocks.providers.mockImplementation(async () =>
    structuredClone(storedProviders),
  );
  commandMocks.currentProvider.mockImplementation(async () => activeProvider);
  commandMocks.upsertProvider.mockImplementation(async (provider) => {
    storedProviders = [
      ...storedProviders.filter((item) => item.name !== provider.name),
      { ...provider, models: [...provider.models] },
    ];
    return null;
  });
  commandMocks.switchProvider.mockImplementation(async (name) => {
    activeProvider = name;
    return null;
  });
  commandMocks.removeProvider.mockImplementation(async (name) => {
    storedProviders = storedProviders.filter(
      (provider) => provider.name !== name,
    );
    return null;
  });
  commandMocks.switchModel.mockImplementation(async (index) => {
    storedProviders.find(
      (provider) => provider.name === activeProvider,
    )!.chosenModel = index;
  });
});

describe("useLLMProviders", () => {
  it("loads providers and derives the active provider and model data", async () => {
    const defaultProvider = makeProvider();
    const customProvider = makeProvider({
      name: "Custom",
      isCustom: true,
      models: ["custom-model"],
    });
    storedProviders = [defaultProvider, customProvider];
    activeProvider = "Custom";

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
    storedProviders = [defaultProvider, deepSeekProvider];
    activeProvider = "deepseek";

    const state = await mountComposable();

    expect(state.selectedProvider.value).toEqual(deepSeekProvider);
  });

  it("trims and persists a new provider before selecting it", async () => {
    const defaultProvider = makeProvider();
    storedProviders = [defaultProvider];
    activeProvider = "Default";

    const state = await mountComposable();

    await state.addProvider("  Custom  ");

    expect(commandMocks.upsertProvider).toHaveBeenCalledWith({
      name: "Custom",
      isCustom: true,
      protocol: "OpenAIChatCompletions",
      baseUrl: "https://api.example.com/v1",
      apiKey: null,
      models: [],
      chosenModel: null,
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
    storedProviders = [provider];
    activeProvider = "Custom";

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

  it("keeps the saved selection and stops dependent commands after a failure", async () => {
    storedProviders = [
      makeProvider(),
      makeProvider({ name: "Custom", isCustom: true }),
    ];
    activeProvider = "Default";
    const state = await mountComposable();
    commandMocks.switchProvider.mockRejectedValueOnce(new Error("failed"));
    await state.selectProvider(1);
    expect(state.selectedProvider.value.name).toBe("Default");
    commandMocks.switchProvider.mockClear();
    commandMocks.upsertProvider.mockRejectedValueOnce(new Error("failed"));
    await state.addProvider("New");
    expect(commandMocks.switchProvider).not.toHaveBeenCalled();
    expect(state.providers).toHaveLength(2);
    expect(commandMocks.error).toHaveBeenCalledTimes(2);
  });
});

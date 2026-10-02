import { computed, onMounted, reactive, ref } from "vue";
import type { SelectorData } from "@/components/base/VSelector.types";
import { commands, type LLMProvider } from "@/services/cmds";
import { showError } from "@/services/errors";

export function useLLMProviders() {
  const providers = reactive<LLMProvider[]>([]);
  const selectedProviderIndex = ref(0);
  const selectedProvider = computed(
    () => providers[selectedProviderIndex.value],
  );
  const providerData = computed<SelectorData>(() => ({
    label: "Provider",
    selectedIndex: selectedProviderIndex.value,
    mutable: true,
    items: providers.map((provider) => ({
      label: provider.name,
      mutable: provider.isCustom,
    })),
  }));
  const modelData = computed<SelectorData>(() => {
    const provider = selectedProvider.value;

    return {
      label: "Model",
      selectedIndex: provider?.chosenModel ?? 0,
      mutable: provider?.isCustom ?? false,
      items:
        provider?.models.map((model) => ({
          label: model,
          mutable: provider.isCustom,
        })) ?? [],
    };
  });
  const logCommandError = (cause: unknown) =>
    showError("配置命令执行失败:", cause);
  const saveSelectedProvider = () =>
    commands.upsertProvider(selectedProvider.value!).catch(logCommandError);

  const selectProvider = async (index: number) => {
    selectedProviderIndex.value = index;
    await commands
      .switchProvider(selectedProvider.value!.name)
      .catch(logCommandError);
  };
  const addProvider = async (name: string) => {
    const provider: LLMProvider = {
      name: name.trim(),
      isCustom: true,
      protocol: "OpenAIChatCompletions",
      baseUrl: "https://api.example.com/v1",
      apiKey: null,
      models: [],
      chosenModel: null,
    };
    await commands.upsertProvider(provider).catch(logCommandError);
    providers.push(provider);
    await selectProvider(providers.length - 1);
  };
  const renameProvider = async (index: number, name: string) => {
    const previous = providers[index];
    const provider = { ...previous, name: name.trim() };
    await commands.upsertProvider(provider).catch(logCommandError);
    if (index === selectedProviderIndex.value)
      await commands.switchProvider(provider.name).catch(logCommandError);
    await commands.removeProvider(previous.name).catch(logCommandError);
    providers[index] = provider;
  };
  const deleteProvider = async (index: number) => {
    const provider = providers[index];
    if (index === selectedProviderIndex.value) {
      await commands.switchProvider(providers[0].name).catch(logCommandError);
    }
    await commands.removeProvider(provider.name).catch(logCommandError);
    providers.splice(index, 1);
    selectedProviderIndex.value =
      index === selectedProviderIndex.value
        ? 0
        : index < selectedProviderIndex.value
          ? selectedProviderIndex.value - 1
          : selectedProviderIndex.value;
  };

  const selectModel = async (index: number) => {
    selectedProvider.value!.chosenModel = index;
    await commands.switchModel(index);
  };
  const addModel = async (name: string) => {
    const provider = selectedProvider.value!;
    provider.models.push(name.trim());
    await saveSelectedProvider();
    await selectModel(provider.models.length - 1);
  };
  const renameModel = async (index: number, name: string) => {
    selectedProvider.value!.models[index] = name.trim();
    await saveSelectedProvider();
  };
  const deleteModel = async (index: number) => {
    const provider = selectedProvider.value!;
    provider.models.splice(index, 1);
    if (provider.chosenModel === index) provider.chosenModel = null;
    else if ((provider.chosenModel ?? -1) > index) provider.chosenModel! -= 1;
    await saveSelectedProvider();
  };
  onMounted(async () => {
    const [loadedProviders, activeProvider] = await Promise.all([
      commands.providers(),
      commands.currentProvider(),
    ]);
    providers.push(...loadedProviders);
    const normalizedActiveProvider = activeProvider.toLowerCase();
    selectedProviderIndex.value = Math.max(
      0,
      loadedProviders.findIndex(
        (provider) => provider.name.toLowerCase() === normalizedActiveProvider,
      ),
    );
  });

  return {
    providers,
    selectedProviderIndex,
    providerData,
    modelData,
    selectedProvider,
    selectProvider,
    addProvider,
    renameProvider,
    deleteProvider,
    selectModel,
    addModel,
    renameModel,
    deleteModel,
    saveSelectedProvider,
  };
}

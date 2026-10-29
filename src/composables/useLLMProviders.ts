import { computed, onMounted, reactive, ref } from "vue";
import type { SelectorData } from "@/components/base/VSelector/types";
import { commands, type LLMProvider } from "@/services/cmds";
import { useConfig } from "@/composables/useConfig";
import { label } from "@/labels";

export function useLLMProviders() {
  const providers = reactive<LLMProvider[]>([]);
  const selectedProviderIndex = ref(0);
  const selectedProvider = computed(
    () => providers[selectedProviderIndex.value],
  );
  const providerData = computed<SelectorData>(() => ({
    label: label("provider"),
    annotation:
      "从列表选择用于 AI 答题的服务商。点击“New”可添加自定义服务；自定义接口需兼容 OpenAI Chat Completions 格式，并在 Model 中添加该服务支持的模型。",
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
      label: label("model"),
      annotation:
        "选择服务商提供的模型。添加自定义模型时，点击“New”并填写服务商控制台中的模型 ID，名称需完全一致，例如 glm-4.7-flash。",
      selectedIndex: provider?.chosenModel ?? 0,
      mutable: provider?.isCustom ?? false,
      items:
        provider?.models.map((model) => ({
          label: model,
          mutable: provider.isCustom,
        })) ?? [],
    };
  });
  const { load, save } = useConfig(
    () => Promise.all([commands.providers(), commands.currentProvider()]),
    ([loadedProviders, activeProvider]) => {
      providers.splice(0, providers.length, ...loadedProviders);
      const normalizedActiveProvider = activeProvider.toLowerCase();
      selectedProviderIndex.value = Math.max(
        0,
        loadedProviders.findIndex(
          (provider) =>
            provider.name.toLowerCase() === normalizedActiveProvider,
        ),
      );
    },
    "配置命令执行失败:",
  );
  const saveSelectedProvider = () =>
    save(() => commands.upsertProvider(selectedProvider.value!));
  const saveApiKey = (key: string) => save(() => commands.setKey(key));

  const selectProvider = (index: number) =>
    save(() => commands.switchProvider(providers[index].name));
  const addProvider = (name: string) =>
    save(async () => {
      const provider: LLMProvider = {
        name: name.trim(),
        isCustom: true,
        protocol: "OpenAIChatCompletions",
        baseUrl: "https://api.example.com/v1",
        apiKey: null,
        models: [],
        chosenModel: null,
      };
      await commands.upsertProvider(provider);
      await commands.switchProvider(provider.name);
    });
  const renameProvider = (index: number, name: string) =>
    save(async () => {
      const previous = providers[index];
      const provider = { ...previous, name: name.trim() };
      await commands.upsertProvider(provider);
      if (index === selectedProviderIndex.value)
        await commands.switchProvider(provider.name);
      await commands.removeProvider(previous.name);
    });
  const deleteProvider = (index: number) =>
    save(async () => {
      const provider = providers[index];
      if (index === selectedProviderIndex.value) {
        await commands.switchProvider(providers[0].name);
      }
      await commands.removeProvider(provider.name);
    });

  const selectModel = (index: number) =>
    save(() => commands.switchModel(index));
  const addModel = (name: string) =>
    save(async () => {
      const provider = selectedProvider.value!;
      await commands.upsertProvider({
        ...provider,
        models: [...provider.models, name.trim()],
      });
      await commands.switchModel(provider.models.length);
    });
  const renameModel = (index: number, name: string) =>
    save(async () => {
      const provider = selectedProvider.value!;
      await commands.upsertProvider({
        ...provider,
        models: provider.models.map((model, modelIndex) =>
          modelIndex === index ? name.trim() : model,
        ),
      });
    });
  const deleteModel = (index: number) =>
    save(async () => {
      const provider = selectedProvider.value!;
      let chosenModel = provider.chosenModel;
      if (chosenModel === index) chosenModel = null;
      else if (chosenModel !== null && chosenModel > index) chosenModel -= 1;
      await commands.upsertProvider({
        ...provider,
        models: provider.models.filter((_, modelIndex) => modelIndex !== index),
        chosenModel,
      });
    });
  onMounted(load);

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
    saveApiKey,
  };
}

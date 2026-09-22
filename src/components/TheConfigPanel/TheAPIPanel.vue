<script setup lang="ts">
import { computed } from "vue";
import VInput from "@/components/base/VInput.vue";
import VSelector from "@/components/base/VSelector.vue";
import { useLLMProviders } from "@/composables/useLLMProviders";
import { commands } from "@/services/cmds";

const {
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
} = useLLMProviders();

const endpoint = computed({
  get: () => selectedProvider.value?.baseUrl ?? "",
  set: (value: string | number) => {
    selectedProvider.value!.baseUrl = String(value);
  },
});
const apiKey = computed({
  get: () => selectedProvider.value?.apiKey ?? "",
  set: (value: string | number) => {
    selectedProvider.value!.apiKey = String(value) || null;
  },
});
const saveApiKey = () =>
  commands
    .setKey(apiKey.value)
    .catch((cause) => console.error("配置命令执行失败:", cause));
</script>

<template>
  <div class="api-panel">
    <div class="settings-container custom-scrollbar">
      <VSelector
        class="element"
        :data="providerData"
        :methods="{
          select: selectProvider,
          create: addProvider,
          edit: renameProvider,
          remove: deleteProvider,
        }"
      />
      <VSelector
        class="element"
        :data="modelData"
        :methods="{
          select: selectModel,
          create: addModel,
          edit: renameModel,
          remove: deleteModel,
        }"
      />
      <VInput
        v-model="endpoint"
        label="Endpoint"
        :disabled="!selectedProvider?.isCustom"
        placeholder="https://api.example.com/v1"
        class="element"
        @change="saveSelectedProvider"
      />
      <VInput
        v-model="apiKey"
        label="API Key"
        :disabled="!selectedProvider"
        placeholder="Enter API key"
        mask-on-blur
        class="element"
        @change="saveApiKey"
      />
    </div>
  </div>
</template>

<style scoped>
.api-panel {
  height: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.settings-container {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 5%;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}

.element {
  flex: 0 0 auto;
  height: 15%;
  width: 100%;
}

:deep(.base-config-select:first-child .select-dropdown-wrapper) {
  z-index: 20;
}

:deep(.base-config-select:nth-child(2) .select-dropdown-wrapper) {
  z-index: 19;
}
</style>

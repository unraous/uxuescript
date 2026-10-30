<script setup lang="ts">
import { computed, ref } from "vue";
import VInput from "@/components/base/VInput.vue";
import VSelector from "@/components/base/VSelector.vue";
import VButton from "@/components/base/VButton.vue";
import { useLLMProviders } from "@/composables/useLLMProviders";
import { commands } from "@/services/cmds";
import { showError } from "@/services/errors";
import { label } from "@/labels";

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
  saveApiKey,
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
const testing = ref(false);
const testConnection = async () => {
  testing.value = true;
  try {
    await commands.healthy();
    await commands.confirm(label("connectionSuccess"), null);
  } catch (cause) {
    await showError(label("connectionFailed"), cause);
  } finally {
    testing.value = false;
  }
};
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
        :label="label('endpoint')"
        annotation="填写完整的请求地址。例如：https://api.example.com/v1/chat/completions。自定义服务需兼容 OpenAI Chat Completions 格式。"
        :disabled="!selectedProvider?.isCustom"
        placeholder="https://api.example.com/v1/chat/completions"
        class="element"
        @change="saveSelectedProvider"
      />
      <VInput
        v-model="apiKey"
        :label="label('apiKey')"
        annotation="粘贴服务商控制台生成的 API Key，密钥需至少 12 个 ASCII 字符。"
        :disabled="!selectedProvider"
        placeholder="Enter API key"
        mask-on-blur
        class="element"
        @change="saveApiKey(apiKey)"
      />
      <div class="element test-button">
        <VButton
          :label="label(testing ? 'testing' : 'testConnection')"
          :disabled="testing || !selectedProvider"
          class="button-text"
          style="width: 65%; height: 100%"
          @click="testConnection"
        />
      </div>
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
  padding: 0 5%;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}

.element {
  flex: 0 0 auto;
  height: 17.5%;
  width: 100%;
}

.test-button {
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.base-config-select:first-child .select-dropdown-wrapper) {
  z-index: 20;
}

:deep(.base-config-select:nth-child(2) .select-dropdown-wrapper) {
  z-index: 19;
}
</style>

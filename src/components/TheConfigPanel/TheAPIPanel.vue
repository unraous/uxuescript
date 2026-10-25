<script setup lang="ts">
import { computed, ref, watch } from "vue";
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
} = useLLMProviders();

const endpoint = computed({
  get: () => selectedProvider.value?.baseUrl ?? "",
  set: (value: string | number) => {
    selectedProvider.value!.baseUrl = String(value);
  },
});

/** 只保存用户本次输入的新 Key；已保存 Key 永不从后端回显。 */
const newApiKey = ref("");
watch(selectedProvider, () => {
  newApiKey.value = "";
});
const hasKey = computed(() => selectedProvider.value?.hasKey === true);
const keyAnnotation = computed(() =>
  hasKey.value
    ? `${label("keyStored")} ${label("keyEnter")}`
    : label("keyMissing"),
);

const saveApiKey = async () => {
  if (!newApiKey.value.trim()) {
    await commands.confirm(label("keyRequired"));
    return;
  }
  try {
    await commands.setKey(newApiKey.value);
    await commands.saveConfig();
    newApiKey.value = "";
    if (selectedProvider.value) selectedProvider.value.hasKey = true;
  } catch (cause) {
    showError("配置命令执行失败:", cause);
  }
};

const clearApiKey = async () => {
  if (!hasKey.value) return;
  if (!(await commands.confirm(label("clearKeyConfirm")))) return;
  try {
    await commands.clearKey();
    await commands.saveConfig();
    newApiKey.value = "";
    if (selectedProvider.value) selectedProvider.value.hasKey = false;
  } catch (cause) {
    showError("配置命令执行失败:", cause);
  }
};

const testing = ref(false);
const testConnection = async () => {
  testing.value = true;
  try {
    await commands.healthy();
    await commands.confirm(label("connectionSuccess"));
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
        v-model="newApiKey"
        :label="label('apiKey')"
        :annotation="keyAnnotation"
        :disabled="!selectedProvider"
        :placeholder="hasKey ? '••••••••（已保存，不回显）' : 'Enter API key'"
        mask-on-blur
        class="element"
        @change="saveApiKey"
      />
      <div class="element key-actions">
        <VButton
          :label="label('saveKey')"
          :disabled="!selectedProvider || !newApiKey.trim()"
          class="button-text"
          @click="saveApiKey"
        />
        <VButton
          :label="label('clearKey')"
          :disabled="!selectedProvider || !hasKey"
          class="button-text"
          @click="clearApiKey"
        />
      </div>
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

.key-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5%;
}

.key-actions > * {
  flex: 1;
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

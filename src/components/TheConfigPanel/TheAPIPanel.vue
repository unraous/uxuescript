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

/** 只保存“新输入的 Key”；已有 Key 永远不会回填到前端。 */
const newApiKey = ref("");
const savingKey = ref(false);
const clearingKey = ref(false);

watch(selectedProvider, () => {
  newApiKey.value = "";
});

const saveApiKey = async () => {
  const value = newApiKey.value.trim();
  const provider = selectedProvider.value;
  if (!value || !provider || savingKey.value) return;
  savingKey.value = true;
  try {
    await commands.setKey(value);
    provider.hasKey = true;
    newApiKey.value = "";
    await commands.confirm(label("keySaved"));
  } catch (cause) {
    await showError("设置 API Key 失败:", cause);
  } finally {
    savingKey.value = false;
  }
};

const clearApiKey = async () => {
  const provider = selectedProvider.value;
  if (!provider?.hasKey || clearingKey.value) return;
  const confirmed = await commands.confirm(label("clearKeyConfirm"));
  if (!confirmed) return;
  clearingKey.value = true;
  try {
    await commands.clearKey();
    provider.hasKey = false;
    newApiKey.value = "";
  } catch (cause) {
    await showError("清除 API Key 失败:", cause);
  } finally {
    clearingKey.value = false;
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
        annotation="已保存的 Key 不会回显。输入新 Key 可替换，或使用下方按钮清除；正式答题仍由你本人在平台原生界面提交。"
        :disabled="!selectedProvider"
        placeholder="输入新 API Key（不会显示旧 Key）"
        secret
        class="element"
        @change="saveApiKey"
      />
      <div class="key-status">
        <span :class="{ configured: selectedProvider?.hasKey }">
          {{ selectedProvider?.hasKey ? label("keyConfigured") : label("keyMissing") }}
        </span>
      </div>
      <div class="key-actions">
        <VButton
          :label="label('setKey')"
          :disabled="!newApiKey.trim() || savingKey || !selectedProvider"
          class="button-text"
          style="width: 48%; height: 100%"
          @click="saveApiKey"
        />
        <VButton
          :label="label('clearKey')"
          :disabled="!selectedProvider?.hasKey || clearingKey || !selectedProvider"
          class="button-text"
          style="width: 48%; height: 100%"
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
  gap: 2.5%;
  padding: 0 5%;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}

.element {
  flex: 0 0 auto;
  height: 14%;
  width: 100%;
}

.key-status {
  flex: 0 0 auto;
  min-height: 4%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  font-size: 0.8rem;
  color: var(--theme-brand);
  opacity: 0.8;
}

.key-status .configured {
  font-weight: 700;
}

.key-actions {
  flex: 0 0 9%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4%;
}

.test-button {
  flex: 0 0 10%;
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

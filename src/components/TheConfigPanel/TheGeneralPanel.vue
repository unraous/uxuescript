<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import VSelector from "@/components/base/VSelector.vue";
import VInput from "@/components/base/VInput.vue";
import { commands } from "@/services/cmds";
import { useConfig } from "@/composables/useConfig";
import { nonZeroU32 } from "@/composables/useConfig/schemas";
import {
  label,
  labelLanguage,
  loadLabelLanguage,
  setLabelLanguage,
} from "@/labels";

const languages = ["en", "zh"] as const;
const languageData = computed(() => ({
  label: label("labelLanguage"),
  annotation: label("languageDescription"),
  selectedIndex: languages.indexOf(labelLanguage.value),
  mutable: false,
  items: [
    { label: "English", mutable: false },
    { label: "中文", mutable: false },
  ],
}));
const selectLanguage = (index: number) =>
  save(() => setLabelLanguage(languages[index]));

const concurrency = ref("");
const batchSize = ref("");
const { load, save, saveField } = useConfig(
  loadLabelLanguage,
  (general) => {
    concurrency.value = String(general.concurrency ?? 10);
    batchSize.value = String(general.batchSize ?? 5);
  },
  "通用配置操作失败:",
);
onMounted(load);
</script>

<template>
  <div class="general-panel">
    <VSelector
      class="option"
      :data="languageData"
      :methods="{ select: selectLanguage }"
    />
    <VInput
      id="model-concurrency"
      v-model="concurrency"
      pattern="[0-9]*"
      :label="label('modelConcurrency')"
      annotation="同时发送的答题请求上限，默认 10。遇到限流后，本次求解会降为串行重试；这与课程设置中的操作等待时间不同。修改从下一次求解生效。"
      class="option number-input"
      @change="
        saveField(commands.setGeneral, 'concurrency', concurrency, nonZeroU32)
      "
    />
    <VInput
      id="model-batch-size"
      v-model="batchSize"
      pattern="[0-9]*"
      :label="label('modelBatchSize')"
      annotation="每次请求最多包含的题目数，默认 5。题目较长或包含图片时可减小；数值越大，单次请求的上下文和输出需求越高。修改从下一次求解生效。"
      class="option number-input"
      @change="
        saveField(commands.setGeneral, 'batchSize', batchSize, nonZeroU32)
      "
    />
  </div>
</template>

<style scoped>
.general-panel {
  height: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5%;
}
.option {
  height: 20%;
}
.number-input :deep(.input-field) {
  text-align: center;
}
</style>

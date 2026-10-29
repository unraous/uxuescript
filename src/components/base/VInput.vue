<script setup lang="ts">
import { useId } from "vue";
import VTextBox from "./VTextBox.vue";
import VLabel from "./VLabel.vue";

const {
  modelValue,
  label,
  annotation = undefined,
  placeholder = "",
  pattern = ".*",
  maskOnBlur,
  disabled = false,
  id = useId(),
} = defineProps<{
  modelValue: string | number;
  label: string;
  annotation?: string;
  placeholder?: string;
  pattern?: string;
  maskOnBlur?: boolean;
  disabled?: boolean;
  id?: string;
}>();

const emit = defineEmits(["update:modelValue", "change"]);
</script>

<template>
  <div class="base-config-input">
    <!-- 仅保留文本标签，设定固定宽度以确保右侧输入框对齐 -->
    <VLabel
      class="label"
      :label="label"
      :for="id"
      :annotation="annotation"
    />
    <VTextBox
      :id="id"
      :model-value="modelValue"
      :placeholder="placeholder"
      :pattern="pattern"
      :mask-on-blur="maskOnBlur"
      :disabled="disabled"
      class="input-section"
      @update:model-value="emit('update:modelValue', $event)"
      @change="emit('change', $event)"
    />
  </div>
</template>

<style scoped>
.base-config-input {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
}

.label {
  height: 100%;
}

.input-section {
  height: 100%;
  flex-grow: 1;
}
</style>

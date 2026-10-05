<script setup lang="ts">
import { computed, ref } from "vue";

const {
  modelValue,
  placeholder,
  pattern,
  id,
  maskOnBlur,
  disabled = false,
} = defineProps<{
  modelValue: string | number;
  placeholder: string;
  pattern: string;
  id: string;
  maskOnBlur?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits(["update:modelValue", "change"]);
const inputFocused = ref(false);
const inputRef = ref<HTMLInputElement | null>(null);
defineExpose({ focus: () => inputRef.value?.focus() });
const displayValue = computed(() =>
  maskOnBlur && !inputFocused.value
    ? "*".repeat(String(modelValue).length)
    : modelValue,
);

const onInput = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const value = target.value;

  if (pattern && value !== "" && !new RegExp(`^(?:${pattern})$`).test(value)) {
    target.value = String(modelValue ?? "");
    return;
  }

  emit("update:modelValue", value);
};
</script>

<template>
  <div
    class="base-text-box"
    :class="{ 'is-disabled': disabled }"
  >
    <div
      class="input-surface"
      :inert="disabled"
    >
      <input
        :id="id"
        ref="inputRef"
        :disabled="disabled"
        :value="displayValue"
        :placeholder="placeholder"
        :pattern="pattern"
        autocomplete="off"
        class="input-field"
        @input="onInput"
        @focus="inputFocused = true"
        @blur="inputFocused = false"
        @change="$emit('change', $event)"
      />
      <div
        v-if="$slots.trailing"
        class="trailing-content"
      >
        <slot name="trailing" />
      </div>
    </div>
    <div class="shadow-shell" />
  </div>
</template>

<style scoped>
.base-text-box {
  --brand-color: var(--theme-brand);
  --base-thickness: 2px;
  --lift-thickness: 5px;

  position: relative;
  width: 100%;
}

.input-surface {
  position: relative;
  z-index: 5;
  width: 100%;
  height: 100%;
  transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.input-surface:focus-within {
  transform: translate(-3px, -3px);
}

.trailing-content {
  position: absolute;
  inset-block: 0;
  right: 12px;
  z-index: 6;
  display: flex;
  align-items: center;
}

.input-field {
  width: 100%;
  height: 100%;
  padding: 0 12px;
  background-color: transparent;
  color: var(--brand-color);
  border: 0px;
  border-radius: 0;
  outline: none;
  font-size: 1.1rem;
  font-weight: 600;
  position: relative;
  z-index: 5;

  transition: all 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.shadow-shell {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: var(--brand-color);
  z-index: 1;
  pointer-events: none;

  --t: var(--base-thickness);
  clip-path: polygon(
    calc(100% - var(--t)) 0,
    100% var(--t),
    100% 100%,
    var(--t) 100%,
    0 calc(100% - var(--t)),
    calc(100% - var(--t)) calc(100% - var(--t))
  );

  transition:
    clip-path 0.2s cubic-bezier(0.2, 0, 0, 1),
    background 0.2s ease,
    transform 0.2s cubic-bezier(0.2, 0, 0, 1);
}

.input-surface:focus-within ~ .shadow-shell {
  --t: var(--lift-thickness);
  background: var(--brand-color);
}

.input-surface:hover ~ .shadow-shell {
  background: var(--brand-color);
}

.input-field::placeholder {
  color: color-mix(in srgb, var(--brand-color), transparent 60%);
}

.is-disabled .shadow-shell {
  --t: 0px;
}

.is-disabled .input-surface {
  transform: none;
}

.input-field:disabled {
  opacity: 1;
  cursor: default;
  -webkit-text-fill-color: var(--brand-color);
}
</style>

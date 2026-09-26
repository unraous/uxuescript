<script setup lang="ts">
import { useScaleFeedback } from "@/composables/useScaleFeedback";

const { items, modelValue } = defineProps<{
  items: { name: string }[];
  modelValue: number;
}>();

const emit = defineEmits<{
  (event: "update:modelValue", value: number): void;
}>();

const {
  handlePointerEnter,
  handlePointerLeave,
  handlePointerDown,
  handlePointerUp,
} = useScaleFeedback({ hoverScale: 1.25 });
</script>

<template>
  <div class="sidebar">
    <div class="sidebar-content custom-scrollbar">
      <div class="menu-layer">
        <button
          v-for="(item, index) in items"
          :key="item.name"
          type="button"
          class="menu-item"
          :class="{ active: modelValue === index }"
          @click="emit('update:modelValue', index)"
          @pointerenter="handlePointerEnter"
          @pointerleave="handlePointerLeave"
          @pointerdown="handlePointerDown"
          @pointerup="handlePointerUp"
        >
          {{ item.name }}
        </button>
      </div>
      <div
        class="background-layer"
        aria-hidden="true"
      >
        <div
          class="selection-indicator"
          :style="{ transform: `translateY(${modelValue * 100}%)` }"
        ></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  --item-height: 22.5%;
  --sidebar-padding: 5%;

  position: relative;
  height: 100%;
  padding-block: var(--sidebar-padding);
  overflow: hidden;
}

.sidebar-content {
  position: relative;
  width: 100%;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}

.background-layer,
.menu-layer {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
}

.background-layer {
  z-index: 0;
  pointer-events: none;
}

.selection-indicator {
  position: absolute;
  top: 0;
  width: 100%;
  height: var(--item-height);
  background: color-mix(in srgb, var(--theme-muted) 10%, transparent);
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.menu-layer {
  z-index: 1;
}

.menu-item {
  flex: 0 0 var(--item-height);
  width: 100%;
  height: var(--item-height);
  border-radius: 0px;
  border: 0px;
  color: var(--theme-brand);
  font-size: 1.25em;
  background-color: transparent;
  transform-origin: center;
}
</style>

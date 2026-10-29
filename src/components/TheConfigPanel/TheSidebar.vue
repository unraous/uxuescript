<script setup lang="ts">
import { nextTick } from "vue";
import { useScaleFeedback } from "@/composables/useScaleFeedback";
import VRollTransition from "@/components/base/VRollTransition.vue";
import { label } from "@/labels";

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

const tabId = (index: number) => `config-tab-${index}`;
const panelId = (index: number) => `config-panel-${index}`;

const handleTabKeydown = (event: KeyboardEvent, index: number) => {
  if (items.length === 0) return;

  let nextIndex: number | undefined;
  if (event.key === "ArrowDown") nextIndex = (index + 1) % items.length;
  else if (event.key === "ArrowUp")
    nextIndex = (index - 1 + items.length) % items.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = items.length - 1;

  if (nextIndex === undefined) return;
  event.preventDefault();
  const focusedIndex = nextIndex;
  emit("update:modelValue", nextIndex);
  void nextTick(() => document.getElementById(tabId(focusedIndex))?.focus());
};
</script>

<template>
  <div class="sidebar">
    <div class="sidebar-content custom-scrollbar">
      <div
        class="menu-layer"
        role="tablist"
        :aria-label="label('configSections')"
        aria-orientation="vertical"
      >
        <button
          v-for="(item, index) in items"
          :id="tabId(index)"
          :key="index"
          type="button"
          role="tab"
          :aria-label="item.name"
          :aria-controls="panelId(index)"
          :aria-selected="modelValue === index"
          :tabindex="modelValue === index ? 0 : -1"
          class="menu-item"
          :class="{ active: modelValue === index }"
          @click="emit('update:modelValue', index)"
          @keydown="handleTabKeydown($event, index)"
          @pointerenter="handlePointerEnter"
          @pointerleave="handlePointerLeave"
          @pointerdown="handlePointerDown"
          @pointerup="handlePointerUp"
        >
          <VRollTransition
            v-slot="{ value }"
            :value="item.name"
            class="menu-text"
            aria-hidden="true"
          >
            {{ value }}
          </VRollTransition>
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
  --item-height: 28%;
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

.menu-text {
  width: 100%;
  height: 1.5em;
}

.menu-text :deep(.roll-item) {
  justify-content: center;
}
</style>

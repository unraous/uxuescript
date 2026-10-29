<script setup lang="ts">
import DeleteIcon from "@/assets/delete.svg?component";
import EditIcon from "@/assets/edit.svg?component";
import NewIcon from "@/assets/new.svg?component";
import { useScaleFeedback } from "@/composables/useScaleFeedback";
import type { SelectorItem } from "./types";
import VRollTransition from "@/components/base/VRollTransition.vue";
import { label } from "@/labels";

defineOptions({ name: "VSelectorDropdown" });

const { data, methods } = defineProps<{
  data: {
    items: SelectorItem[];
    selectedIndex: number;
    mutable: boolean;
    optionHeight: string;
  };
  methods: {
    select(index: number): void;
    create(): void;
    edit(index: number): void;
    remove(index: number): void;
  };
}>();

const scaleFeedback = useScaleFeedback({ hoverScale: 1.25 });
</script>

<template>
  <div
    class="select-dropdown-wrapper"
    :style="{ '--option-height': data.optionHeight }"
  >
    <ul class="select-dropdown custom-scrollbar">
      <li
        v-for="(item, index) in data.items"
        :key="index"
        class="select-option"
        :class="{ 'is-selected': index === data.selectedIndex }"
      >
        <button
          type="button"
          class="option-label"
          @click="methods.select(index)"
        >
          {{ item.label }}
        </button>
        <template v-if="item.mutable">
          <button
            type="button"
            class="option-action"
            :aria-label="`${label('edit')} ${item.label}`"
            @click="methods.edit(index)"
            @pointerenter="scaleFeedback.handlePointerEnter"
            @pointerleave="scaleFeedback.handlePointerLeave"
          >
            <EditIcon
              class="action-icon action-icon-compact"
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            class="option-action is-danger"
            :aria-label="`${label('remove')} ${item.label}`"
            @click="methods.remove(index)"
            @pointerenter="scaleFeedback.handlePointerEnter"
            @pointerleave="scaleFeedback.handlePointerLeave"
          >
            <DeleteIcon
              class="action-icon action-icon-compact"
              aria-hidden="true"
            />
          </button>
        </template>
      </li>
      <li
        v-if="data.mutable"
        class="select-option"
      >
        <button
          type="button"
          class="option-label option-create"
          :aria-label="label('create')"
          @click="methods.create"
        >
          <NewIcon
            class="action-icon create-icon"
            aria-hidden="true"
          />
          <VRollTransition v-slot="{ value }" :value="label('create')" class="create-text" aria-hidden="true">
            {{ value }}
          </VRollTransition>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.create-text {
  flex: 1;
  height: 1.5em;
}

.select-dropdown-wrapper {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  width: 100%;
  z-index: 10;
  overflow: hidden;
}

.select-dropdown {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  box-sizing: border-box;
  background-image: var(--theme-page-gradient);
  background-size: 100vw 100vh;
  background-position: left top;
  background-repeat: no-repeat;
  background-attachment: fixed;
  border: 2px solid var(--theme-brand);
  border-top: none;
  max-height: 175px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--theme-brand) 15%, transparent);
}

.select-option {
  position: relative;
  isolation: isolate;
  height: var(--option-height);
  width: 100%;
  box-sizing: border-box;
  padding: 0;
  display: flex;
  align-items: center;
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease-in-out;
}

.select-option::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background-color: color-mix(in srgb, var(--theme-black) 8%, transparent);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.15s ease-out;
}

.select-option:hover:not(.is-selected)::before {
  transform: scaleX(1);
}

.option-label,
.option-action {
  height: 100%;
  padding: 0 12px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.option-action {
  flex: 0 0 auto;
  align-self: center;
  width: var(--option-height);
  height: 75%;
  padding: 0;
  color: var(--theme-brand);
  display: flex;
  align-items: center;
  justify-content: center;
}

.option-create {
  flex: 1;
  align-self: center;
  height: 75%;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 0.375rem;
  justify-content: flex-start;
  color: var(--theme-brand);
}

.action-icon {
  width: 75%;
  height: 75%;
  fill: currentColor;
}

.create-icon {
  width: auto;
  height: 60%;
}

.action-icon-compact {
  width: 60%;
  height: 60%;
}

.select-option.is-selected {
  background-color: var(--theme-brand);
  color: var(--theme-white);
}

.select-option.is-selected::before {
  content: none;
}

.is-selected .option-action {
  color: var(--theme-white);
}
</style>

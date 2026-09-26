<script setup lang="ts">
import { computed, ref } from "vue";
import SaveIcon from "@/assets/save.svg?component";
import CancelIcon from "@/assets/cancel.svg?component";
import { useScaleFeedback } from "@/composables/useScaleFeedback";
import VTextBox from "./VTextBox.vue";

const { data, methods } = defineProps<{
  data: { active: boolean; draft: string; id: string };
  methods: {
    updateDraft(value: string): void;
    save(): void;
    cancel(): void;
  };
}>();

const inputRef = ref<InstanceType<typeof VTextBox> | null>(null);
const scaleFeedback = useScaleFeedback({ hoverScale: 1.2 });
const canSave = computed(() => Boolean(data.draft.trim()));
defineExpose({ focus: () => inputRef.value?.focus() });

const onEnter = (event: KeyboardEvent) => {
  if (!(event.target instanceof HTMLInputElement) || event.isComposing) return;
  event.preventDefault();
  event.stopPropagation();
  methods.save();
};

const keepEditorFocused = (event: PointerEvent) => event.preventDefault();

const handleSavePointerEnter = (event: PointerEvent) => {
  if (canSave.value) scaleFeedback.handlePointerEnter(event);
};
</script>

<template>
  <VTextBox
    :id="data.id"
    ref="inputRef"
    class="select-editor"
    :inert="!data.active"
    :aria-hidden="!data.active"
    :model-value="data.draft"
    placeholder=""
    pattern=".*"
    @update:model-value="methods.updateDraft(String($event))"
    @keydown.enter="onEnter"
    @keydown.escape.stop.prevent="methods.cancel"
  >
    <template #trailing>
      <div
        v-if="data.active"
        class="editor-actions"
      >
        <button
          type="button"
          aria-label="Save"
          :disabled="!canSave"
          @click.stop="methods.save"
          @pointerdown="keepEditorFocused"
          @pointerenter="handleSavePointerEnter"
          @pointerleave="scaleFeedback.handlePointerLeave"
        >
          <SaveIcon
            class="action-icon"
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          aria-label="Cancel"
          @click.stop="methods.cancel"
          @pointerenter="scaleFeedback.handlePointerEnter"
          @pointerleave="scaleFeedback.handlePointerLeave"
        >
          <CancelIcon
            class="action-icon"
            aria-hidden="true"
          />
        </button>
      </div>
    </template>
  </VTextBox>
</template>

<style scoped>
.editor-actions {
  display: flex;
  align-items: center;
  height: 100%;
  gap: 0.5rem;
  margin-left: 0.5rem;
}

.editor-actions button {
  width: 1.5rem;
  height: 75%;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--theme-brand);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-icon {
  width: 90%;
  height: 90%;
  fill: currentColor;
}

.editor-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>

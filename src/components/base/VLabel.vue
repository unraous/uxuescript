<script setup lang="ts">
import { onUnmounted, ref, useAttrs, useId } from "vue";
import VAnnotation from "./VAnnotation.vue";
import VRollTransition from "./VRollTransition.vue";

defineOptions({ inheritAttrs: false });

const { label, for: htmlFor = undefined, annotation = undefined } = defineProps<{
  label: string;
  for?: string;
  annotation?: string;
}>();

const attrs = useAttrs();
const id = `label-annotation-${useId()}`;
const isVisible = ref(false);
const isFocused = ref(false);
const textElement = ref<HTMLSpanElement | null>(null);
const anchorY = ref(0);
let hideTimer: ReturnType<typeof setTimeout> | undefined;

const show = (event?: PointerEvent) => {
  if (!annotation) return;
  if (hideTimer) clearTimeout(hideTimer);
  const rect = textElement.value?.getBoundingClientRect();
  anchorY.value = event?.clientY ?? (rect ? rect.top + rect.height / 2 : 0);
  isVisible.value = true;
};

const scheduleHide = () => {
  hideTimer = setTimeout(() => {
    if (!isFocused.value) isVisible.value = false;
  }, 100);
};

const focusLabel = () => {
  isFocused.value = true;
  show();
};

const blurLabel = () => {
  isFocused.value = false;
  scheduleHide();
};

const keepVisible = () => {
  if (hideTimer) clearTimeout(hideTimer);
};

onUnmounted(() => {
  if (hideTimer) clearTimeout(hideTimer);
});
</script>

<template>
  <component
    :is="htmlFor ? 'label' : 'span'"
    v-bind="attrs"
    class="label-text"
    :for="htmlFor"
    :aria-label="label"
    :tabindex="annotation ? 0 : undefined"
    :aria-describedby="annotation ? id : undefined"
    @focus="focusLabel"
    @blur="blurLabel"
  >
    <span
      ref="textElement"
      class="label-content"
      aria-hidden="true"
      @pointerenter="show"
      @pointerleave="scheduleHide"
    >
      <VRollTransition v-slot="{ value }" :value="label" class="label-roll">
        {{ value }}
      </VRollTransition>
    </span>
  </component>

  <VAnnotation
    v-if="annotation"
    :id="id"
    :anchor="textElement"
    :anchor-y="anchorY"
    :text="annotation"
    :visible="isVisible"
    @pointerenter="keepVisible"
    @pointerleave="scheduleHide"
  />
</template>

<style scoped>
.label-text {
  position: relative;
  flex-shrink: 0;
  width: 40%;
  height: 100%;
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 1.25rem;
  color: var(--theme-brand);
  letter-spacing: 1px;
  outline-color: var(--theme-brand);
}

.label-content,
.label-roll {
  width: 100%;
  height: 100%;
}

.label-content {
  display: block;
}

.label-roll {
  /* size 容器不会被文字撑高，label 的父级居中布局也可能没有确定高度。 */
  min-height: 1.5em;
}

.label-roll :deep(.roll-item) {
  justify-content: center;
}
</style>

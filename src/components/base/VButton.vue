<script setup lang="ts">
import { computed, ref, type Component } from "vue";
import { useMagnetic } from "@/composables/useMagnetic";
import { createRipple } from "@/effects/ripple";

const buttonRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);

const {
  label = undefined,
  icon = undefined,
  background = undefined,
  color = undefined,
  size = "32px",
  shape = "pill",
  variant = "brand",
  disabled = false,
  type = "button",
} = defineProps<{
  label?: string;
  icon?: Component;
  shape?: "pill" | "circle";
  /** 预设风格：'brand' (主色极光) | 'translucent' (黑半透明) | 'custom' (自定义) */
  variant?: "brand" | "translucent" | "custom";
  background?: string;
  color?: string;
  size?: string;
  disabled?: boolean;
  /** 按钮类型：'button' | 'submit' | 'reset' */
  type?: "button" | "submit" | "reset";
}>();

useMagnetic(buttonRef, contentRef, {
  outerFactor: 0.1,
  innerFactor: 0.2,
  disabled: () => disabled,
});

const onPointerDown = (event: PointerEvent) => {
  createRipple(event, {
    scale: 2.5,
    duration: 0.75,
    disabled,
  });
};

const buttonStyle = computed(() => ({
  height: shape === "circle" ? undefined : size,
  width: shape === "circle" ? size : undefined,
  background,
  color,
}));
</script>

<template>
  <button
    ref="buttonRef"
    :type="type"
    class="base-button"
    :class="[`variant-${variant}`, { 'shape-circle': shape === 'circle' }]"
    :disabled="disabled"
    :style="buttonStyle"
    @pointerdown="onPointerDown"
  >
    <div
      ref="contentRef"
      class="content"
    >
      <slot>
        <component
          :is="icon"
          v-if="icon"
          class="icon-svg"
        />
        <span
          v-else-if="label"
          class="label-text"
        >
          {{ label }}
        </span>
      </slot>
    </div>
  </button>
</template>

<style scoped>
.base-button {
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  box-shadow: 0 4px 12px color-mix(in srgb, black 15%, transparent);
  transition:
    opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    filter 0.25s ease,
    box-shadow 0.3s ease;
}

.base-button.shape-circle {
  aspect-ratio: 1;
  height: auto;
  flex: 0 0 auto;
}

.base-button:not(:disabled):hover {
  filter: brightness(1.15);
}

/* 预设风格 */
.variant-brand {
  --brand-color: var(--theme-brand);
  color: var(--theme-surface);
  background: conic-gradient(
    from 145deg at 50% 0%,
    color-mix(in srgb, var(--brand-color), black 25%) 0deg,
    var(--brand-color) 160deg,
    color-mix(in srgb, var(--brand-color), white 75%) 180deg,
    var(--brand-color) 200deg,
    color-mix(in srgb, var(--brand-color), black 25%) 360deg
  );
}

.variant-translucent {
  background-color: transparent;
  backdrop-filter: blur(4px);
}

.content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-svg {
  width: 75%;
  height: 75%;
  fill: currentColor;
}

.base-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
  filter: grayscale(0.5);
}
</style>

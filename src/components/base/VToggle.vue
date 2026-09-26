<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId, watch } from "vue";
import { gsap } from "gsap";
import VLabel from "./VLabel.vue";
import { useScaleFeedback } from "@/composables/useScaleFeedback";

const {
  label,
  modelValue = false,
  id = useId(),
} = defineProps<{
  label: string;
  modelValue?: boolean;
  id?: string;
}>();

const emit = defineEmits(["update:modelValue"]);

const ringGradientId = `${id}-ring-gradient`;
const toggleRoot = ref<HTMLElement>();
const ring = ref<HTMLElement>();
const ball = ref<HTMLElement>();
let rotationAngle = 180;
let settledBallState = false;

const scaleFeedback = useScaleFeedback({
  hoverScale: 1.25,
});

const toggle = () => {
  emit("update:modelValue", !modelValue);
};

const animatePress = () => {
  if (!ring.value) return;
  gsap.killTweensOf(ring.value);
  gsap.to(ring.value, {
    rotate: rotationAngle - 45,
    duration: 0.25,
    ease: "power2.out",
  });
};

const animateRelease = () => {
  if (!ring.value) return;
  gsap.killTweensOf(ring.value);
  gsap.to(ring.value, {
    rotate: rotationAngle,
    duration: 0.18,
    ease: "power2.out",
  });
};

const handlePointerLeave = (event: PointerEvent) => {
  scaleFeedback.handlePointerLeave(event);
  animateRelease();
  syncBallState(modelValue);
};

const handlePointerDown = (event: PointerEvent) => {
  scaleFeedback.handlePointerDown(event);
  animatePress();
};

const handlePointerUp = (event: PointerEvent) => {
  scaleFeedback.handlePointerUp(event);
  animateRelease();
};

const playBallAppear = (ballElement: HTMLElement) => {
  gsap.set(ballElement, { autoAlpha: 1, y: -50 });
  gsap.to(ballElement, {
    y: 0,
    duration: 0.25,
    ease: "bounce.out",
    onComplete: () => {
      settledBallState = true;
    },
  });
};

const playBallDisappear = (ballElement: HTMLElement) => {
  gsap.to(ballElement, {
    autoAlpha: 0,
    y: 50,
    duration: 0.25,
    ease: "power2.in",
    onComplete: () => {
      settledBallState = false;
    },
  });
};

const syncBallState = (isOn: boolean) => {
  if (!ball.value || isOn === settledBallState) return;
  if (isOn) playBallAppear(ball.value);
  else playBallDisappear(ball.value);
};

const animateStateChange = (wasOn: boolean, isOn: boolean) => {
  if (!ring.value || !ball.value || wasOn === isOn) return;

  const ringElement = ring.value;
  const ballElement = ball.value;
  rotationAngle += 180;
  gsap.killTweensOf([ringElement, ballElement]);
  gsap.set(
    ballElement,
    settledBallState ? { autoAlpha: 1, y: 0 } : { autoAlpha: 0, y: 50 },
  );
  gsap.to(ringElement, {
    rotate: rotationAngle,
    duration: 0.25,
    ease: "back.out(2.5)",
    onComplete: () => {
      syncBallState(isOn);
    },
  });
};

watch(
  () => modelValue,
  (nextValue, previousValue) => animateStateChange(previousValue, nextValue),
);

onMounted(() => {
  rotationAngle = modelValue ? 0 : 180;
  settledBallState = modelValue;
  gsap.set(ring.value!, { rotate: rotationAngle });
  gsap.set(ball.value!, {
    autoAlpha: modelValue ? 1 : 0,
    y: modelValue ? 0 : 50,
  });
});

onUnmounted(() => {
  gsap.killTweensOf([toggleRoot.value, ring.value, ball.value]);
});
</script>

<template>
  <div class="base-config-input">
    <VLabel
      :label="label"
      :for="id"
    />

    <div class="input-section">
      <div
        :id="id"
        ref="toggleRoot"
        class="bowl-toggle"
        role="switch"
        :aria-checked="modelValue"
        tabindex="0"
        @click="toggle"
        @pointerenter="scaleFeedback.handlePointerEnter"
        @pointerleave="handlePointerLeave"
        @pointerdown="handlePointerDown"
        @pointerup="handlePointerUp"
        @keydown.space.prevent="toggle"
        @keydown.enter.prevent="toggle"
      >
        <!-- 变量控制中心 -->
        <div class="canvas-area">
          <div
            ref="ring"
            class="bowl-ring"
          >
            <svg
              viewBox="0 0 40 40"
              class="bowl-svg"
            >
              <defs>
                <linearGradient
                  :id="ringGradientId"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop
                    offset="0%"
                    stop-color="var(--theme-brand-deeper)"
                  />
                  <stop
                    offset="50%"
                    stop-color="var(--theme-brand)"
                  />
                  <stop
                    offset="100%"
                    stop-color="var(--theme-brand)"
                  />
                </linearGradient>
              </defs>
              <path
                d="M 3,20 A 17,17 0 0 0 37,20"
                fill="none"
                :stroke="`url(#${ringGradientId})`"
                stroke-width="5"
                stroke-linecap="round"
              />
            </svg>
          </div>

          <div class="ball-clip-box">
            <div
              ref="ball"
              class="ball"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.base-config-input {
  display: flex;
  align-items: center;
  width: 100%;
}

.input-section {
  flex: 1;
  display: flex;
  justify-content: center;
}

.bowl-toggle {
  width: 20%;
  height: 100%;
  cursor: pointer;
  display: flex;
  justify-content: center;
  align-items: center;
  user-select: none;
}

/* --- 变量控制中心 --- */
.canvas-area {
  position: relative;

  /* 基础尺寸与颜色 */
  --size: 80%;
  --max-size: 3rem;
  --color: var(--theme-brand);
  --ball-size: 60%;

  width: min(var(--size), var(--max-size));
  aspect-ratio: 1;
  height: auto;
  color: var(--color); /* 传导给 SVG 的 scaleColor */
}

.bowl-ring {
  position: absolute;
  inset: 0;
  transform-origin: center;
  z-index: 2;
}

.ball-clip-box {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 1;
}

.ball {
  position: absolute;
  width: var(--ball-size);
  height: var(--ball-size);
  background: conic-gradient(
    from 145deg at 50% 0%,
    color-mix(in srgb, var(--color), black 25%) 0deg,
    var(--color) 160deg,
    color-mix(in srgb, var(--color), white 75%) 180deg,
    var(--color) 200deg,
    color-mix(in srgb, var(--color), black 25%) 360deg
  );
  border-radius: 50%;
  visibility: hidden;
  left: calc((100% - var(--ball-size)) / 2);
  top: calc((100% - var(--ball-size)) / 2);
}

.bowl-toggle:hover .bowl-ring,
.bowl-toggle:hover .ball {
  filter: brightness(1.25);
}
</style>

<script setup lang="ts">
import { gsap } from "gsap";
import { onMounted, onUnmounted, ref } from "vue";
import { useScaleFeedback } from "@/composables/useScaleFeedback";
import { label, loadLabelLanguage } from "@/labels";
import VRollTransition from "@/components/base/VRollTransition.vue";

const props = defineProps<{
  message: string;
  title?: string | null;
  readSeconds?: number | null;
}>();
const emit = defineEmits<{ finished: [choice: boolean] }>();
const scaleFeedback = useScaleFeedback({ hoverScale: 1.25 });

const backdrop = ref<HTMLElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
const countdown = ref<HTMLElement | null>(null);
let animation: gsap.core.Timeline | null = null;
let countdownExit: gsap.core.Tween | null = null;
let closing = false;
const remaining = ref(props.readSeconds ?? 0);
const displayedSeconds = ref(remaining.value);
const showCountdown = ref(remaining.value > 0);
const countdownWidth = `calc(${String(remaining.value).length}ch + 0.4em)`;
let timer: ReturnType<typeof setInterval> | undefined;

const startCountdown = () => {
  const deadline = Date.now() + remaining.value * 1000;
  timer = setInterval(() => {
    remaining.value = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remaining.value > 0) {
      displayedSeconds.value = remaining.value;
      return;
    }
    clearInterval(timer);
    countdownExit = gsap.to(countdown.value, {
      xPercent: 100,
      duration: 0.25,
      ease: "power2.inOut",
      onComplete: () => (showCountdown.value = false),
    });
  }, 250);
};

onMounted(() => {
  void loadLabelLanguage().catch((cause) =>
    console.error("加载确认弹窗语言失败:", cause),
  );
  animation = gsap
    .timeline()
    .fromTo(backdrop.value, { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0)
    .fromTo(
      dialog.value,
      { opacity: 0, y: "4vh", scale: 0.96 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.42,
        ease: "power3.out",
      },
      0.08,
    );
  if (showCountdown.value) {
    animation.fromTo(
      countdown.value,
      { xPercent: 100, visibility: "visible" },
      {
        xPercent: 0,
        duration: 0.25,
        ease: "power2.inOut",
        onComplete: startCountdown,
      },
    );
  }
});

const choose = (choice: boolean) => {
  if (closing || (choice && remaining.value > 0)) return;
  closing = true;
  clearInterval(timer);
  animation?.kill();
  countdownExit?.kill();
  animation = gsap
    .timeline({ onComplete: () => emit("finished", choice) })
    .to(
      dialog.value,
      { opacity: 0, y: "-3vh", scale: 0.97, duration: 0.28, ease: "power2.in" },
      0,
    )
    .to(backdrop.value, { opacity: 0, duration: 0.3 }, 0.05);
};

onUnmounted(() => {
  clearInterval(timer);
  animation?.kill();
  countdownExit?.kill();
});
</script>

<template>
  <div
    ref="backdrop"
    class="confirmation-backdrop"
  >
    <section
      ref="dialog"
      class="confirmation-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="title ?? label('confirmation')"
    >
      <header class="title">
        <h1>{{ title ?? label("confirmation") }}</h1>
      </header>
      <div class="message custom-scrollbar">
        <div class="message-content">{{ message }}</div>
      </div>
      <div class="actions">
        <div class="yes-choice">
          <div
            v-if="showCountdown"
            class="countdown"
            :style="{ width: countdownWidth }"
            :aria-label="`剩余 ${displayedSeconds} 秒`"
          >
            <div
              ref="countdown"
              class="countdown-motion"
            >
              <VRollTransition
                v-slot="{ value }"
                :value="displayedSeconds"
                class="countdown-roll"
                aria-hidden="true"
              >
                {{ value }}
              </VRollTransition>
            </div>
          </div>
          <button
            type="button"
            class="choice-button"
            :disabled="remaining > 0"
            @click="choose(true)"
            @pointerenter="scaleFeedback.handlePointerEnter"
            @pointerleave="scaleFeedback.handlePointerLeave"
            @pointerdown="scaleFeedback.handlePointerDown"
            @pointerup="scaleFeedback.handlePointerUp"
          >
            Yes
          </button>
        </div>
        <button
          type="button"
          class="choice-button"
          @click="choose(false)"
          @pointerenter="scaleFeedback.handlePointerEnter"
          @pointerleave="scaleFeedback.handlePointerLeave"
          @pointerdown="scaleFeedback.handlePointerDown"
          @pointerup="scaleFeedback.handlePointerUp"
        >
          No
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.confirmation-backdrop {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4vmin;
  box-sizing: border-box;
  background: rgb(0 0 0 / 55%);
  pointer-events: auto;
}

.confirmation-dialog {
  width: 33%;
  max-height: 67%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 2vmin;
  border-radius: 1.25em;
  /* 两个遮罩的视口不同，以各自视口设置局部字号，子元素用 em 跟随。 */
  font-size: 1.8vmin;
  background: var(--theme-page-gradient);
  color: var(--theme-brand);
  box-shadow: 0 1.25em 3em
    color-mix(in srgb, var(--theme-black) 25%, transparent);
}

.message {
  flex: 0 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  padding: 0 10%;
  text-align: center;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 1.25em;
  line-height: 1.5;
}

.message-content {
  flex: 0 0 auto;
  margin-block: auto;
}

.title,
.actions {
  flex: 0 0 calc(2.5em + 2vmin);
}

.title {
  display: flex;
  align-items: center;
  justify-content: center;
}

.title h1 {
  margin: 0;
  font-size: 2em;
}

.actions {
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 0.5em;
}

.choice-button {
  width: 4.4em;
  height: 2em;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--theme-brand);
  font: inherit;
  font-size: 1.25em;
  font-weight: 600;
  cursor: pointer;
}

.yes-choice {
  position: relative;
}

.countdown {
  position: absolute;
  right: 100%;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  font-size: 1.25em;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
}

.countdown-motion {
  visibility: hidden;
}

.countdown-roll {
  height: 1.5em;
  text-align: center;
}

.countdown-roll :deep(.roll-item) {
  justify-content: center;
}

.choice-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

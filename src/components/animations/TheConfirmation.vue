<script setup lang="ts">
import { gsap } from "gsap";
import { onMounted, onUnmounted, ref } from "vue";
import { useScaleFeedback } from "@/composables/useScaleFeedback";

defineProps<{ message: string }>();
const emit = defineEmits<{ finished: [choice: boolean] }>();
const scaleFeedback = useScaleFeedback({ hoverScale: 1.25 });

const backdrop = ref<HTMLElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
let animation: gsap.core.Timeline | null = null;
let closing = false;

onMounted(() => {
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
});

const choose = (choice: boolean) => {
  if (closing) return;
  closing = true;
  animation?.kill();
  animation = gsap
    .timeline({ onComplete: () => emit("finished", choice) })
    .to(
      dialog.value,
      { opacity: 0, y: "-3vh", scale: 0.97, duration: 0.28, ease: "power2.in" },
      0,
    )
    .to(backdrop.value, { opacity: 0, duration: 0.3 }, 0.05);
};

onUnmounted(() => animation?.kill());
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
      aria-label="Confirmation"
    >
      <h1 class="title">Confirmation</h1>
      <div class="message custom-scrollbar">{{ message }}</div>
      <div class="actions">
        <button
          type="button"
          class="choice-button"
          @click="choose(true)"
          @pointerenter="scaleFeedback.handlePointerEnter"
          @pointerleave="scaleFeedback.handlePointerLeave"
          @pointerdown="scaleFeedback.handlePointerDown"
          @pointerup="scaleFeedback.handlePointerUp"
        >
          Yes
        </button>
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
  width: 25%;
  height: 50%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 1.5vmin 2vmin 2vmin;
  border-radius: 1.25rem;
  background: var(--theme-page-gradient);
  color: var(--theme-brand);
  box-shadow: 0 1.25rem 3rem rgb(0 0 0 / 25%);
}

.title {
  flex: 0 0 20%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  font-size: 2rem;
}

.message {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  padding: 0 10%;
  text-align: center;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 1.25rem;
  line-height: 1.5;
}

.actions {
  flex: 0 0 calc(2.5rem + 2vmin);
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  gap: 0.5rem;
}

.choice-button {
  width: 5.5rem;
  height: 2.5rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--theme-brand);
  font: inherit;
  font-size: 1.25rem;
  font-weight: 600;
  cursor: pointer;
}
</style>

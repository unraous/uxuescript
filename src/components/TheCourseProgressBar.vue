<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

const props = defineProps<{
  progress: number;
}>();

const normalizedProgress = computed(() =>
  Math.min(Math.max(props.progress, 0), 100),
);

const container = ref<HTMLDivElement | null>(null);
const trackWidth = ref(0);
const trackHeight = ref(0);
let resizeObserver: ResizeObserver | null = null;

const minimumVisibleProgress = computed(() =>
  trackWidth.value > 0
    ? Math.min((trackHeight.value / trackWidth.value) * 100, 100)
    : 0,
);

const visibleProgress = computed(() =>
  normalizedProgress.value === 0
    ? 0
    : Math.max(normalizedProgress.value, minimumVisibleProgress.value),
);

const activeClipStyle = computed(() => ({
  width: `${visibleProgress.value}%`,
}));

const activeGradientStyle = computed(() => ({
  width: trackWidth.value > 0 ? `${trackWidth.value}px` : "100%",
}));

onMounted(() => {
  if (!container.value) return;

  resizeObserver = new ResizeObserver(([entry]) => {
    trackWidth.value = entry.contentRect.width;
    trackHeight.value = entry.contentRect.height;
  });
  resizeObserver.observe(container.value);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <div
    ref="container"
    class="container"
    role="progressbar"
    :aria-valuenow="normalizedProgress"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <div class="background-bar"></div>
    <div class="active-clip" :style="activeClipStyle">
      <div class="active-bar" :style="activeGradientStyle"></div>
    </div>
  </div>
</template>

<style scoped>
.container {
  position: relative;
  width: 90%;
  height: 30%;
}

.background-bar,
.active-clip {
  position: absolute;
  left: 0;
}

.background-bar {
  top: 20%;
  width: 100%;
  height: 60%;
  border-radius: 999px;
  background-color: color-mix(in srgb, var(--theme-brand) 25%, transparent);
}

.active-clip {
  top: 0;
  height: 100%;
  border-radius: 999px;
  overflow: hidden;
  transition: width 0.25s ease-out;
}

.active-bar {
  height: 100%;
  --brand-color: var(--theme-brand);
  background: conic-gradient(
    from 145deg at 50% 0%,
    color-mix(in srgb, var(--brand-color), black 25%) 0deg,
    var(--brand-color) 160deg,
    color-mix(in srgb, var(--brand-color), white 75%) 180deg,
    var(--brand-color) 200deg,
    color-mix(in srgb, var(--brand-color), black 25%) 360deg
  );
}
</style>

<script setup lang="ts">
import { gsap } from "gsap";
import { onMounted, onUnmounted, ref } from "vue";

const root = ref<HTMLElement | null>(null);
let tween: gsap.core.Tween | null = null;

onMounted(() => {
  if (!root.value) return;
  tween = gsap.to(root.value, {
    opacity: 1,
    duration: 0.5,
    ease: "power1.out",
  });
});

onUnmounted(() => tween?.kill());
</script>

<template>
  <div
    ref="root"
    class="closing-mask"
  />
</template>

<style scoped>
.closing-mask {
  position: absolute;
  inset: 0;
  background: #000;
  opacity: 0;
}
</style>

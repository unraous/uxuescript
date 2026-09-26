<script setup lang="ts">
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { onMounted, onUnmounted, shallowRef, type Component } from "vue";
import Intro from "@/components/animations/TheIntro.vue";
import Close from "@/components/animations/TheClose.vue";
import { commands } from "./services/cmds";

interface AnimationLayer {
  id: number;
  component: Component;
  onFinished?: () => void;
}

const layers = shallowRef<AnimationLayer[]>([]);
let nextLayerId = 0;
let unlistenStartEvent: (() => void) | null = null;
let unlistenCloseEvent: (() => void) | null = null;
let isUnmounted = false;

const startIntro = () => {
  const id = nextLayerId++;
  layers.value = [
    ...layers.value,
    {
      id,
      component: Intro,
      onFinished: () => {
        layers.value = layers.value.filter((layer) => layer.id !== id);
        void commands.hideMask();
      },
    },
  ];
};

const closeMask = () => {
  layers.value = [...layers.value, { id: nextLayerId++, component: Close }];
};

onMounted(async () => {
  const webview = getCurrentWebview();
  unlistenStartEvent = await webview.listen("start-event", startIntro);
  if (isUnmounted) {
    unlistenStartEvent();
    return;
  }
  unlistenCloseEvent = await webview.listen("close-event", closeMask);
  if (isUnmounted) {
    unlistenStartEvent();
    unlistenCloseEvent();
    return;
  }
  await commands.startMask();
});

onUnmounted(() => {
  isUnmounted = true;
  unlistenStartEvent?.();
  unlistenCloseEvent?.();
});
</script>

<template>
  <main class="mask">
    <div
      v-for="layer in layers"
      :key="layer.id"
      class="mask-layer"
    >
      <component
        :is="layer.component"
        @finished="layer.onFinished?.()"
      />
    </div>
  </main>
</template>

<style>
@font-face {
  font-family: "DefaultFont";
  src: url("@/assets/fonts/Mixture.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
}

html,
body,
#mask {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

body {
  margin: 0;
}

.mask {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: transparent;
  pointer-events: none;
}

.mask-layer {
  position: absolute;
  inset: 0;
}
</style>

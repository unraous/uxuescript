<script setup lang="ts">
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { emitTo } from "@tauri-apps/api/event";
import { onMounted, onUnmounted, shallowRef, type Component } from "vue";
import Intro from "./TheIntro.vue";
import Close from "./TheClose.vue";
import Confirmation from "./TheConfirmation.vue";
import { commands } from "@/services/cmds";

const { startup = false } = defineProps<{ startup?: boolean }>();

interface AnimationLayer {
  id: number;
  component: Component;
  props?: Record<string, unknown>;
  onFinished?: (choice?: boolean) => void;
}

const layers = shallowRef<AnimationLayer[]>([]);
let unlisteners: Array<() => void> = [];
let nextLayerId = 0;
let isUnmounted = false;

const removeLayer = (id: number) => {
  layers.value = layers.value.filter((layer) => layer.id !== id);
};

const startIntro = () => {
  const id = nextLayerId++;
  layers.value = [...layers.value, {
    id,
    component: Intro,
    onFinished: () => {
      removeLayer(id);
      void commands.hideMask();
    },
  }];
};

const closeMask = () => {
  layers.value = [...layers.value, { id: nextLayerId++, component: Close }];
};

const showConfirmation = (message: string) => {
  const id = nextLayerId++;
  layers.value = [...layers.value, {
    id,
    component: Confirmation,
    props: { message },
    onFinished: (choice) => {
      removeLayer(id);
      void emitTo(getCurrentWebview().label, "confirmation-result", choice === true);
    },
  }];
};

onMounted(async () => {
  const webview = getCurrentWebview();
  const listeners = [
    webview.listen<string>("confirmation-pop-up", (event) => showConfirmation(event.payload)),
    webview.listen("start-event", startIntro),
    webview.listen("close-event", closeMask),
  ];
  const ready = await Promise.all(listeners);
  if (isUnmounted) {
    ready.forEach((unlisten) => unlisten());
    return;
  }
  unlisteners = ready;
  if (startup) await commands.startMask();
});

onUnmounted(() => {
  isUnmounted = true;
  unlisteners.forEach((unlisten) => unlisten());
});
</script>

<template>
  <main class="mask">
    <div v-for="layer in layers" :key="layer.id" class="mask-layer">
      <component :is="layer.component" v-bind="layer.props" @finished="layer.onFinished?.($event)" />
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

:root {
  font-family: "DefaultFont", Inter, Avenir, Helvetica, Arial, sans-serif;
  font-size: 16px;
}

button,
input,
select,
textarea {
  font-family: inherit;
  font-size: inherit;
}

html,
body,
#mask,
#chaoxing-mask {
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

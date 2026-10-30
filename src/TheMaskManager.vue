<script setup lang="ts">
import { emit, emitTo } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { onMounted, onUnmounted, shallowRef, type Component } from "vue";
import { commands } from "@/services/cmds";
import type { ConfirmOptions } from "@/services/cmds";
import Close from "@/components/animations/TheClose.vue";
import Confirmation from "@/components/animations/TheConfirmation.vue";
import Intro from "@/components/animations/TheIntro.vue";
import TaskProgress from "@/components/animations/TheTaskProgress.vue";

const { startup = false } = defineProps<{ startup?: boolean }>();

interface Layer {
  id: number;
  component: Component;
  props?: Record<string, unknown>;
  onFinished?: (choice?: boolean) => void;
}

const layers = shallowRef<Layer[]>([]);
let unlisteners: Array<() => void> = [];
let nextLayerId = 0;
let isUnmounted = false;
let closeLayerId: number | undefined;
let taskLayerId: number | undefined;

const removeLayer = (id: number) => {
  layers.value = layers.value.filter((layer) => layer.id !== id);
  if (taskLayerId === id) taskLayerId = undefined;
  if (closeLayerId === id) closeLayerId = undefined;
};

const updateLayerProps = (id: number, props: Record<string, unknown>) => {
  layers.value = layers.value.map((layer) =>
    layer.id === id ? { ...layer, props: { ...layer.props, ...props } } : layer,
  );
};

const startIntro = () => {
  const id = nextLayerId++;
  layers.value = [
    ...layers.value,
    {
      id,
      component: Intro,
      onFinished: () => {
        removeLayer(id);
        void commands.hideMask(true);
      },
    },
  ];
};

const closeMask = () => {
  if (taskLayerId !== undefined) removeLayer(taskLayerId);
  closeLayerId = nextLayerId++;
  layers.value = [...layers.value, { id: closeLayerId, component: Close }];
};

const cancelCloseMask = () => {
  if (closeLayerId !== undefined) removeLayer(closeLayerId);
};

const showTaskProgress = (preview = false) => {
  if (taskLayerId !== undefined) removeLayer(taskLayerId);
  const id = nextLayerId++;
  taskLayerId = id;
  layers.value = [
    ...layers.value,
    {
      id,
      component: TaskProgress,
      props: {
        preview,
        downloadProgress: undefined,
        previewProgress: undefined,
      },
      onFinished: () => {
        removeLayer(id);
        if (layers.value.length === 0) void commands.hideMask(false);
      },
    },
  ];
};

const startUpdateDownload = () => showTaskProgress();

const startPreviewUpdateDownload = () => showTaskProgress(true);

const reportUpdateProgress = (progress: {
  downloaded: number;
  total: number | null;
}) => {
  if (taskLayerId !== undefined)
    updateLayerProps(taskLayerId, { downloadProgress: progress });
};

const reportPreviewUpdateProgress = (progress: number) => {
  if (taskLayerId !== undefined)
    updateLayerProps(taskLayerId, { previewProgress: progress });
};

const finishUpdateDownload = () => {
  if (taskLayerId !== undefined) {
    updateLayerProps(taskLayerId, { failed: true });
  } else if (layers.value.length === 0) {
    void commands.hideMask(false);
  }
};

const showConfirmation = ({
  message,
  options,
}: {
  message: string;
  options: ConfirmOptions | null;
}) => {
  const id = nextLayerId++;
  layers.value = [
    ...layers.value,
    {
      id,
      component: Confirmation,
      props: {
        message,
        title: options?.title,
        readSeconds: options?.readSeconds,
      },
      onFinished: (choice) => {
        removeLayer(id);
        void emitTo(
          getCurrentWebview().label,
          "confirmation-result",
          choice === true,
        );
      },
    },
  ];
};

const dismissConfirmation = () => {
  for (const layer of layers.value) {
    if (layer.component === Confirmation) layer.onFinished?.(false);
  }
};

onMounted(async () => {
  const webview = getCurrentWebview();
  const listeners = [
    webview.listen<{ message: string; options: ConfirmOptions | null }>(
      "confirmation-pop-up",
      (event) => showConfirmation(event.payload),
    ),
    webview.listen("start-event", startIntro),
    webview.listen("close-event", closeMask),
    webview.listen("close-cancelled", cancelCloseMask),
    webview.listen("update-download-start", startUpdateDownload),
    webview.listen("update-download-preview-start", startPreviewUpdateDownload),
    webview.listen<number>("update-download-preview-progress", (event) =>
      reportPreviewUpdateProgress(event.payload),
    ),
    webview.listen<{ downloaded: number; total: number | null }>(
      "update-download-progress",
      (event) => reportUpdateProgress(event.payload),
    ),
    webview.listen("update-download-failed", finishUpdateDownload),
  ];
  if (webview.label === "chaoxing-mask") {
    listeners.push(
      webview.listen("confirmation-dismissed", dismissConfirmation),
    );
  }
  const ready = await Promise.all(listeners);
  if (isUnmounted) {
    ready.forEach((unlisten) => unlisten());
    return;
  }
  unlisteners = ready;
  if (startup) await emit("mask-ready", {});
});

onUnmounted(() => {
  isUnmounted = true;
  unlisteners.forEach((unlisten) => unlisten());
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
        v-bind="layer.props"
        @finished="layer.onFinished?.($event)"
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

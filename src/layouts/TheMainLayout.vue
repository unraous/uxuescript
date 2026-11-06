<script setup lang="ts">
import TheMenuBar from "@/components/TheMenuBar.vue";
import TheLeftLayout from "./TheLeftLayout.vue";
import TheRightLayout from "./TheRightLayout.vue";
import { onMounted, onUnmounted } from "vue";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { UnlistenFn } from "@tauri-apps/api/event";
import appConfig from "../../src-tauri/tauri.conf.json";
import TheBottomBar from "@/components/TheBottomBar.vue";
import { checkForUpdates } from "@/services/updater";
import { previewUpdateDownload } from "@/services/updateDownloadPreview";

const metadata = {
  title: appConfig.productName,
  author: appConfig.bundle.publisher,
  version: appConfig.version,
};

let unlistenStartup: UnlistenFn | undefined;

onMounted(async () => {
  if (import.meta.env.DEV) {
    window.previewUpdateDownload = previewUpdateDownload;
  }
  unlistenStartup = await getCurrentWebview().once(
    "startup-finished",
    () => void checkForUpdates(metadata.version),
  );
});

onUnmounted(() => {
  unlistenStartup?.();
  if (window.previewUpdateDownload === previewUpdateDownload) {
    delete window.previewUpdateDownload;
  }
});
</script>

<template>
  <div class="container">
    <TheMenuBar
      class="menu-bar"
      :app-title="metadata.title"
    />
    <main class="content">
      <TheLeftLayout class="left" />
      <TheRightLayout class="right" />
    </main>
    <TheBottomBar
      class="bottom-bar"
      :author="metadata.author"
      :version="metadata.version"
    />
  </div>
</template>

<style scoped>
.container {
  display: flex;
  height: 100vh;
  width: 100vw;
  flex-direction: column;
  position: relative;
  background: var(--theme-page-gradient);
}

.left {
  flex: 1;
}

.right {
  width: 50vw;
}

.menu-bar {
  height: 5vh;
}

.content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}

.bottom-bar {
  height: 5vh;
  width: 100vw;
}
</style>

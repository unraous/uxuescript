<script setup lang="ts">
import FolderCodeIcon from "@/assets/folder-code.svg?component";
import { useScaleFeedback } from "@/composables/useScaleFeedback";
import { commands } from "@/services/cmds";
import { openPath } from "@tauri-apps/plugin-opener";

defineProps<{
  version: string;
  author: string;
}>();

const scaleFeedback = useScaleFeedback({ hoverScale: 1.1 });

const openDataDirectory = async () => {
  const paths = await commands.paths();
  const dataDirectory = paths.dirs?.data;

  if (dataDirectory) {
    await openPath(dataDirectory);
  }
};

const handleDirectoryKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    void openDataDirectory();
  }
};
</script>

<template>
  <div class="bottom-bar">
    <div
      class="directory-entry"
      role="button"
      tabindex="0"
      @click="openDataDirectory"
      @keydown="handleDirectoryKeydown"
      @pointerenter="scaleFeedback.handlePointerEnter"
      @pointerleave="scaleFeedback.handlePointerLeave"
      @pointerdown="scaleFeedback.handlePointerDown"
      @pointerup="scaleFeedback.handlePointerUp"
    >
      <FolderCodeIcon class="directory-icon" />
      <span>日志/配置目录</span>
    </div>
    <div class="version-info">
      <p>by {{ author }} v{{ version }}</p>
    </div>
  </div>
</template>

<style scoped>
.bottom-bar {
  background-color: transparent;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.directory-entry {
  padding-left: 2.5vw;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--theme-brand);
  cursor: pointer;
  font-size: 1.25rem;
  transform-origin: center;
}

.directory-icon {
  width: 1.5rem;
  height: 1.5rem;
}

.version-info {
  padding-right: 2.5vw;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
</style>

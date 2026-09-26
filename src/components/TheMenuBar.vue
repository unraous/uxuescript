<script setup lang="ts">
import CloseIcon from "@/assets/close.svg?component";
import MinimizeIcon from "@/assets/remove.svg?component";
import { commands } from "@/services/cmds";
import { ref } from "vue";

defineProps<{
  appTitle: string;
}>();

const minimizeLock = ref(false);
const closeLock = ref(false);
const isMacOS = /Macintosh|Mac OS X/i.test(navigator.userAgent);

const minimizeApp = async () => {
  if (minimizeLock.value) return;
  minimizeLock.value = true;
  await commands.minimize();
  minimizeLock.value = false;
};

const closeApp = async () => {
  if (closeLock.value) return;
  closeLock.value = true;
  await commands.close();
  closeLock.value = false;
};
</script>

<template>
  <div class="menu-bar">
    <div class="title">
      {{ appTitle }}
    </div>
    <button
      v-if="!isMacOS"
      type="button"
      @click="minimizeApp"
    >
      <MinimizeIcon class="icon" />
    </button>
    <button
      v-if="!isMacOS"
      type="button"
      @click="closeApp"
    >
      <CloseIcon class="icon" />
    </button>
  </div>
</template>

<style scoped>
.menu-bar {
  background-color: transparent;
  display: flex;
  flex-direction: row;
  justify-content: flex-end;
  position: relative;
}

.title {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  color: var(--theme-brand);
  letter-spacing: 1px;
  -webkit-text-stroke: 1px currentColor;
  font-size: 2rem;
}

button {
  aspect-ratio: 1;
  border: none;
  border-radius: 0%;
  background-color: transparent;
  color: var(--theme-brand);
  height: 100%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s ease-out;
}

.icon {
  width: 40%;
  height: 40%;
}

/* 悬停状态 */
button:hover {
  background-color: var(--theme-brand);
  color: var(--theme-on-brand-hover);
}
</style>

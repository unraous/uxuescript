<script setup lang="ts">
import TheMainLayout from "@/layouts/TheMainLayout.vue";

const isDev = import.meta.env.DEV;
globalThis.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && ["p", "s", "f"].includes(key)) {
    e.preventDefault();
    return;
  }
  if (!isDev && (((e.ctrlKey || e.metaKey) && key === "r") || key === "f5")) {
    e.preventDefault();
  }
});
</script>

<template>
  <div @contextmenu.prevent>
    <TheMainLayout />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  width: 100%;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
}

body,
#main {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

@font-face {
  font-family: "DefaultFont";
  src: url("@/assets/fonts/Mixture.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
}

:root {
  user-select: none;
  -webkit-text-stroke: 0.25px currentColor;
  font-family: "DefaultFont", Inter, Avenir, Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;
  color: var(--theme-brand);
  background-color: transparent;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

button,
input,
select,
textarea {
  font-family: inherit;
  font-size: inherit;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: var(--theme-brand-deep);
  border-radius: 0;
}
</style>

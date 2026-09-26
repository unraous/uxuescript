<script setup lang="ts">
import TheMenuBar from "@/components/TheMenuBar.vue";
import TheLeftLayout from "./TheLeftLayout.vue";
import TheRightLayout from "./TheRightLayout.vue";
import { onMounted, ref } from "vue";
import { commands, MetadataConfig } from "@/services/cmds.ts";
import TheBottomBar from "@/components/TheBottomBar.vue";

const metadata = ref<MetadataConfig>({
  title: "uxs",
  author: "unraous",
  version: "x.x.x",
});

onMounted(async () => {
  metadata.value = await commands.metadata();
});
</script>

<template>
  <main class="container">
    <TheMenuBar
      class="menu-bar"
      :app-title="metadata.title!"
    />
    <div class="content">
      <TheLeftLayout class="left" />
      <TheRightLayout class="right" />
    </div>
    <TheBottomBar
      class="bottom-bar"
      :author="metadata.author!"
      :version="metadata.version!"
    />
  </main>
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
  display: flex;
  flex-direction: row;
}

.bottom-bar {
  height: 5vh;
  width: 100vw;
}
</style>

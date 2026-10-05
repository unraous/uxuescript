<script setup lang="ts">
import TheChaoxingWebviewController from "@/components/TheChaoxingWebviewController.vue";
import TheCourseDashboard from "@/components/TheCourseDashboard.vue";
</script>

<template>
  <div class="right-container">
    <TheCourseDashboard class="dashboard" />
    <div class="chaoxing-webview">
      <TheChaoxingWebviewController class="controller" />
    </div>
  </div>
</template>

<style scoped>
.right-container {
  display: flex;
  align-items: center;
  flex-direction: column;
  background-color: transparent;
}

.dashboard {
  width: 96%;
  height: 36vh;
}

.chaoxing-webview {
  position: relative;
  width: 48vw;
  height: 53vh;
}

.chaoxing-webview::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: calc(100% + 6px);
  height: calc(100% + 6px);
  background: var(--theme-brand);
  pointer-events: none;
  z-index: 1;

  --t: 6px;
  clip-path: polygon(
    calc(100% - var(--t)) 0,
    100% var(--t),
    100% 100%,
    var(--t) 100%,
    0 calc(100% - var(--t)),
    calc(100% - var(--t)) calc(100% - var(--t))
  );
}

.controller {
  height: 5vh;
  width: 100%;
}

.version-info {
  padding-right: 40px;
  height: 6.25%;
  width: 100%;
  background-color: transparent;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
</style>

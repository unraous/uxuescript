<script setup lang="ts">
import TheConfigPanel from "@/components/TheConfigPanel.vue";
import TheInfoPanel from "@/components/TheInfoPanel.vue";
</script>

<template>
  <div class="left-container">
    <TheInfoPanel class="info-panel" />
    <TheConfigPanel class="config-panel" />
  </div>
</template>

<style scoped>
.left-container {
  display: flex;
  flex-direction: column;
  background-color: transparent;
}

.info-panel {
  height: 47.5%;
}

.config-panel {
  height: 50%;
}
</style>

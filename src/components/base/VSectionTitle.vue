<script setup lang="ts">
import VLabel from "./VLabel.vue";

const { text } = defineProps<{ text: string }>();
</script>

<template>
  <div class="section-title">
    <VLabel
      :label="text"
      role="heading"
      aria-level="2"
    />
  </div>
</template>

<style scoped>
.section-title {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
}

.section-title::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 2px;
  background: linear-gradient(
    to right,
    var(--theme-brand-deeper) 0%,
    var(--theme-brand) 50%,
    var(--theme-brand) 100%
  );
}

.section-title :deep(.label-text) {
  -webkit-text-stroke: 0.5px currentColor;
}
</style>

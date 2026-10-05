<script setup lang="ts">
const { label, for: htmlFor } = defineProps<{
  label: string;
  for: string;
}>();
</script>

<template>
  <label
    :for="htmlFor"
    class="label-text"
  >
    {{ label }}
  </label>
</template>

<style scoped>
.label-text {
  flex-shrink: 0;
  width: 40%; /* 固定的标签宽度 */
  text-align: center;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 1.25rem;
  color: var(--theme-brand);
  letter-spacing: 1px;
}
</style>

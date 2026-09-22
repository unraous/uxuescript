<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import VInput from "@/components/base/VInput.vue";
import VToggle from "@/components/base/VToggle.vue";
import { commands, type OptionsConfig } from "@/services/cmds";

const options = ref<OptionsConfig>();
const speedValue = computed<number>({
  get: () => options.value?.speedValue ?? 1,
  set: (value) => {
    options.value!.speedValue = value;
  },
});
const saveOptions = () =>
  commands
    .setOptions(options.value!)
    .catch((cause) => console.error("保存课程配置失败:", cause));

onMounted(async () => {
  options.value = await commands.options();
});
</script>

<template>
  <div class="course-config-panel">
    <div
      v-if="options"
      class="settings-container"
    >
      <VToggle
        :model-value="options.persistSession ?? false"
        label="Perisist Session"
        class="option"
        @update:model-value="
          options.persistSession = $event;
          saveOptions();
        "
      />
      <VToggle
        :model-value="options.muteWebview ?? false"
        label="Mute Course"
        class="option"
        @update:model-value="
          options.muteWebview = $event;
          saveOptions();
        "
      />
      <VToggle
        :model-value="options.speedLock ?? false"
        label="Lock Playspeed"
        class="option"
        @update:model-value="
          options.speedLock = $event;
          saveOptions();
        "
      />
      <VInput
        id="playing-speed-input"
        v-model.number="speedValue"
        placeholder="input number here"
        label="Playing Speed"
        aria-label=""
        class="option speed-input"
        @change="saveOptions"
      />
    </div>
  </div>
</template>

<style scoped>
.course-config-panel {
  height: 100%;
  flex: 1;
  flex-direction: column;
  display: flex;
}
.settings-container {
  flex: 1;
  display: flex;
  gap: 5%;
  flex-direction: column;
}
.option {
  height: 15%;
}
.speed-input :deep(.input-field) {
  text-align: center;
}
</style>

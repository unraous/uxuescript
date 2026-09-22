<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import VButton from "@/components/base/VButton.vue";
import TheAPIPanel from "@/components/TheConfigPanel/TheAPIPanel.vue";
import TheCourseConfigPanel from "./TheConfigPanel/TheCourseConfigPanel.vue";
import TheSidebar from "./TheConfigPanel/TheSidebar.vue";
import { commands } from "@/services/cmds";

const configPanel = reactive({
  activeIndex: 0,
  items: [{ name: "API" }, { name: "Course" }],
});
const transitionName = ref("config-content-up");
watch(
  () => configPanel.activeIndex,
  (nextIndex, previousIndex) => {
    transitionName.value =
      nextIndex > previousIndex ? "config-content-up" : "config-content-down";
  },
);
</script>

<template>
  <div class="panel">
    <div class="workspace">
      <TheSidebar
        v-model="configPanel.activeIndex"
        :items="configPanel.items"
        class="sidebar"
      />
      <div class="container">
        <Transition :name="transitionName"
          ><TheAPIPanel
            v-show="configPanel.activeIndex === 0"
            class="config-panel-content"
        /></Transition>
        <Transition :name="transitionName"
          ><TheCourseConfigPanel
            v-show="configPanel.activeIndex === 1"
            class="config-panel-content"
        /></Transition>
      </div>
    </div>
    <div class="save-button">
      <VButton
        label="Save"
        class="button-text"
        style="width: 35%; height: 60%"
        @click="commands.saveConfig"
      />
    </div>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
}
.workspace {
  height: 80%;
  width: 100%;
  display: flex;
  flex-direction: row;
}
.sidebar {
  width: 25%;
  height: 100%;
}
.container {
  position: relative;
  width: 75%;
  height: 100%;
  overflow: hidden;
}
.config-panel-content {
  position: absolute;
  inset: 0;
  padding: 7.5%;
  width: 100%;
  height: 100%;
}
.config-content-up-enter-active,
.config-content-up-leave-active,
.config-content-down-enter-active,
.config-content-down-leave-active {
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform;
}
.config-content-up-enter-from,
.config-content-down-leave-to {
  transform: translateY(100%);
}
.config-content-up-leave-to,
.config-content-down-enter-from {
  transform: translateY(-100%);
}
.config-content-up-enter-to,
.config-content-up-leave-from,
.config-content-down-enter-to,
.config-content-down-leave-from {
  transform: translateY(0);
}
.save-button {
  height: 20%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>

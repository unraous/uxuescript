<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import VButton from "@/components/base/VButton.vue";
import VRollTransition from "@/components/base/VRollTransition.vue";
import TheAPIPanel from "@/components/TheConfigPanel/TheAPIPanel.vue";
import TheCourseConfigPanel from "./TheConfigPanel/TheCourseConfigPanel.vue";
import TheThemePanel from "./TheConfigPanel/TheThemePanel.vue";
import TheGeneralPanel from "./TheConfigPanel/TheGeneralPanel.vue";
import TheSidebar from "./TheConfigPanel/TheSidebar.vue";
import { commands } from "@/services/cmds";
import { label } from "@/labels";

const configPanel = reactive({
  activeIndex: 0,
});
const sidebarItems = computed(() => [
  { name: label("tabApi") },
  { name: label("tabCourse") },
  { name: label("tabTheme") },
  { name: label("tabGeneral") },
]);
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
    <h1 class="title">
      <VRollTransition
        v-slot="{ value }"
        :value="label('configuration')"
        class="title-text"
      >
        {{ value }}
      </VRollTransition>
    </h1>
    <div class="workspace">
      <TheSidebar
        v-model="configPanel.activeIndex"
        :items="sidebarItems"
        class="sidebar"
      />
      <div class="container">
        <Transition :name="transitionName"
          ><TheAPIPanel
            v-show="configPanel.activeIndex === 0"
            id="config-panel-0"
            role="tabpanel"
            aria-labelledby="config-tab-0"
            class="config-panel-content"
        /></Transition>
        <Transition :name="transitionName"
          ><TheCourseConfigPanel
            v-show="configPanel.activeIndex === 1"
            id="config-panel-1"
            role="tabpanel"
            aria-labelledby="config-tab-1"
            class="config-panel-content"
        /></Transition>
        <Transition :name="transitionName"
          ><TheThemePanel
            v-show="configPanel.activeIndex === 2"
            id="config-panel-2"
            role="tabpanel"
            aria-labelledby="config-tab-2"
            class="config-panel-content"
        /></Transition>
        <Transition :name="transitionName"
          ><TheGeneralPanel
            v-show="configPanel.activeIndex === 3"
            id="config-panel-3"
            role="tabpanel"
            aria-labelledby="config-tab-3"
            class="config-panel-content"
        /></Transition>
      </div>
    </div>
    <div class="save-button">
      <VButton
        :label="label('save')"
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
  height: 70%;
  width: 100%;
  display: flex;
  flex-direction: row;
}
.title {
  height: 10%;
  width: 100%;
  font-size: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.title-text {
  width: 100%;
  height: 100%;
}
.title-text :deep(.roll-item) {
  justify-content: center;
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

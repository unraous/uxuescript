<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import VSelector from "@/components/base/VSelector.vue";
import type { SelectorData } from "@/components/base/VSelector/types";
import TheAPIPanel from "./TheAPIPanel.vue";
import { useConfig } from "@/composables/useConfig";
import { commands, type SolverKind } from "@/services/cmds";
import { label } from "@/labels";

const solverKinds: SolverKind[] = ["native_llm", "deep_seek_web"];
const solver = ref<SolverKind>("native_llm");
const solverData = computed<SelectorData>(() => ({
  label: label("tabSolver"),
  selectedIndex: solverKinds.indexOf(solver.value),
  mutable: false,
  items: [
    { label: "Native LLM", mutable: false },
    { label: "DeepSeek Web", mutable: false },
  ],
}));
const { load, save } = useConfig(
  commands.currentSolver,
  (kind) => {
    solver.value = kind;
  },
  "求解方式配置命令执行失败:",
);
const selectSolver = (index: number) =>
  save(() => commands.setSolver(solverKinds[index]));
onMounted(load);
</script>

<template>
  <div class="solver-panel">
    <VSelector
      class="solver-selector"
      :data="solverData"
      :methods="{ select: selectSolver }"
    />
    <TheAPIPanel
      v-if="solver === 'native_llm'"
      class="native-panel"
    />
    <p
      v-else
      class="web-solver-notice"
    >
      {{ label("webSolverNotConnected") }}
    </p>
  </div>
</template>

<style scoped>
.solver-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 5%;
}
.solver-selector {
  flex: 0 0 17.5%;
  width: 90%;
  margin: 0 5%;
}
.solver-selector :deep(.select-dropdown-wrapper) {
  z-index: 21;
}
.native-panel {
  flex: 1;
  min-height: 0;
}
.web-solver-notice {
  padding: 0 5%;
}
</style>

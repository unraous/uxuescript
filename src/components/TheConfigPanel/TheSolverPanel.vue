<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import VSelector from "@/components/base/VSelector.vue";
import type { SelectorData } from "@/components/base/VSelector/types";
import TheAPIPanel from "./TheAPIPanel.vue";
import VButton from "@/components/base/VButton.vue";
import { useDeepseekLogin } from "@/composables/useDeepseekLogin";
import { showError } from "@/services/errors";
import { commands, type SolverKind } from "@/services/cmds";
import { label } from "@/labels";

const solverKinds: SolverKind[] = ["native_llm", "deep_seek_web"];
const { active = true } = defineProps<{ active?: boolean }>();
const solver = ref<SolverKind>("native_llm");
const selecting = ref(false);
const { status, diagnostic, view, busy, retry, toggle } = useDeepseekLogin(
  () => active && !selecting.value && solver.value === "deep_seek_web",
);
const solverData = computed<SelectorData>(() => ({
  label: label("tabSolver"),
  selectedIndex: solverKinds.indexOf(solver.value),
  mutable: false,
  items: [
    { label: "Native LLM", mutable: false },
    { label: "DeepSeek Web", mutable: false },
  ],
}));
let revision = 0;
let mounted = true;
let updates = Promise.resolve();
async function load(token: number) {
  const kind = await commands.currentSolver();
  if (mounted && token === revision) solver.value = kind;
}
function selectSolver(index: number) {
  const kind = solverKinds[index];
  const token = ++revision;
  selecting.value = true; // Invalidate login work at click time, before config IPC.
  const operation = updates.then(async () => {
    try {
      await commands.setSolver(kind);
    } catch (error) {
      void showError("求解方式配置命令执行失败:", error);
    }
    try {
      await load(token);
    } catch (error) {
      void showError("求解方式配置命令执行失败:", error);
    } finally {
      if (mounted && token === revision) selecting.value = false;
    }
  });
  updates = operation;
  return operation;
}
onMounted(() => {
  void load(revision).catch((error) =>
    showError("求解方式配置命令执行失败:", error),
  );
});
onUnmounted(() => {
  mounted = false;
  ++revision;
});
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
    <div
      v-else
      class="web-solver-notice"
    >
      <h2>{{ label("webSolverPreviewTitle") }}</h2>
      <p>{{ label("webSolverUsage") }}</p>
      <p>{{ label("webSolverLimitations") }}</p>
      <div
        class="login-status"
        :class="`login-${status}`"
        role="status"
      >
        <p v-if="status === 'checking'">{{ label("deepseekChecking") }}</p>
        <p v-else-if="status === 'unauthenticated'">
          {{ label("deepseekLoginGuide") }}
        </p>
        <p v-else-if="status === 'authenticated'">
          {{ label("deepseekAuthenticated") }}
        </p>
        <template v-else>
          <p>{{ label("deepseekAuthUnknown") }}</p>
          <p
            v-if="diagnostic"
            class="login-detail"
          >
            {{ diagnostic }}
          </p>
          <VButton
            class="login-retry"
            :label="label('retry')"
            :disabled="busy"
            variant="translucent"
            @click="retry"
          />
        </template>
      </div>
      <VButton
        v-if="status === 'authenticated'"
        class="solver-view-button"
        :label="
          view === 'deepseek'
            ? label('returnToCoursePage')
            : label('showSolverPage')
        "
        :disabled="busy || view === null || selecting"
        variant="translucent"
        @click="toggle"
      />
    </div>
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
  flex: 1;
  min-height: 0;
  padding: 0 5%;
  overflow-y: auto;
  overflow-wrap: anywhere;
}
.web-solver-notice h2 {
  font-size: inherit;
  font-weight: inherit;
  -webkit-text-stroke: 0.4px currentColor;
}
.web-solver-notice p {
  margin-top: 0.75em;
}
.login-status {
  border: 1px solid currentColor;
  border-radius: 0.5em;
  padding: 0.5em 0.75em;
  margin-top: 1em;
  font-size: 0.9em;
}
.login-status p {
  margin: 0.25em 0;
}
.login-authenticated {
  color: var(--theme-brand-deep);
}
.login-detail {
  font-size: 0.85em;
}
.solver-view-button,
.login-retry {
  color: var(--theme-brand-deep);
  border: 1px solid var(--theme-brand-deep);
  margin: 0.75em 0;
  min-height: 2.5em;
  height: auto;
  box-shadow: none;
}
</style>

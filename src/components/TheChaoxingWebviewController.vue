<script setup lang="ts">
import { label, translated } from "@/labels";
import ZoomInIcon from "@/assets/zoom_in.svg?component";
import ZoomOutIcon from "@/assets/zoom_out.svg?component";
import ArrowIcon from "@/assets/arrow_forward.svg?component";
import RefreshIcon from "@/assets/refresh.svg?component";
import HomeIcon from "@/assets/home.svg?component";
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import VButton from "@/components/base/VButton.vue";
import VRollTransition from "@/components/base/VRollTransition.vue";
import { commands, type ActiveView } from "@/services/cmds";
import { showError } from "@/services/errors";

// Layers is authoritative, including after HMR or a component remount.
const currentView = ref<ActiveView | null>(null);
const syncing = ref(true);
const courseControlsDisabled = computed(
  () => syncing.value || currentView.value !== "chaoxing",
);
let mounted = true;
let viewRevision = 0;

async function syncView() {
  const revision = viewRevision;
  const view = await commands.currentWebview();
  if (mounted && revision === viewRevision) currentView.value = view;
}

// Webview 缩放控制阶梯表
const ZOOM_LEVELS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5,
  3.0, 4.0, 5.0,
];

const zoomIndex = ref(7); // index to 100%

/** 当前响应式缩放百分比文本 (如 '100%') */
const currentZoomText = computed(
  () => `${Math.round((ZOOM_LEVELS[zoomIndex.value] ?? 1.0) * 100)}%`,
);

const canZoomIn = computed(() => zoomIndex.value < ZOOM_LEVELS.length - 1);
const canZoomOut = computed(() => zoomIndex.value > 0);

watch(zoomIndex, async (newIndex) => {
  await commands
    .setZoom(ZOOM_LEVELS[newIndex])
    .catch((e) => showError("设置Webview缩放失败", e));
});

const zoomIn = () => {
  if (!courseControlsDisabled.value) zoomIndex.value++;
};
const zoomOut = () => {
  if (!courseControlsDisabled.value) zoomIndex.value--;
};

const currentUrl = ref("");
const displayedUrl = computed(() =>
  currentView.value === "deepseek"
    ? "DeepSeek"
    : currentView.value === "chaoxing"
      ? currentUrl.value
      : syncing.value
        ? translated("Syncing view…", "正在同步视图…")
        : translated("View status unknown", "视图状态未知"),
);
const canGoBack = ref(false);
const canGoForward = ref(false);
const isNavigating = ref(false);
let unlistenUrlUpdate: UnlistenFn | null = null;
let unlistenViewUpdate: UnlistenFn | null = null;

const updateNavState = async () => {
  try {
    const [back, forward, url] = await Promise.all([
      commands.canGoBack(),
      commands.canGoForward(),
      commands.currentUrl(),
    ]);
    canGoBack.value = back;
    canGoForward.value = forward;
    currentUrl.value = url ?? "";
  } catch (err) {
    await showError("获取导航状态失败:", err);
  } finally {
    isNavigating.value = false;
  }
};

/** 导航互斥包装：等待 URL 事件更新导航状态后解锁，命令失败时立即解锁。 */
const withNavLock = (
  action: () => Promise<unknown>,
  condition: () => boolean = () => true,
  errMsg = "导航失败:",
) => {
  return async () => {
    if (courseControlsDisabled.value || isNavigating.value || !condition())
      return;
    isNavigating.value = true;
    try {
      await action();
    } catch (err) {
      await showError(errMsg, err);
      isNavigating.value = false;
    }
  };
};

const handleGoBack = withNavLock(
  () => commands.goBack(),
  () => canGoBack.value,
  "后退失败:",
);
const handleGoForward = withNavLock(
  () => commands.goForward(),
  () => canGoForward.value,
  "前进失败:",
);
const handleReload = withNavLock(
  () => commands.reload(),
  () => true,
  "刷新失败:",
);
const handleGoHome = withNavLock(
  () => commands.goHome(),
  () => true,
  "跳转首页失败:",
);

onMounted(async () => {
  updateNavState();
  try {
    const unlisten = await listen<ActiveView>(
      "active-webview-changed",
      (event) => {
        if (mounted) {
          ++viewRevision;
          currentView.value = event.payload;
        }
      },
    );
    if (!mounted) {
      unlisten();
      return;
    }
    unlistenViewUpdate = unlisten;
    await syncView();
  } catch (error) {
    if (mounted)
      await showError(
        translated("Unable to read the active view", "获取当前网页失败"),
        error,
      );
  } finally {
    syncing.value = false;
  }
  if (!mounted) return;
  try {
    const unlisten = await listen("url-update", async (event) => {
      currentUrl.value = event.payload as string;
      await updateNavState();
    });
    if (!mounted) {
      unlisten();
      return;
    }
    unlistenUrlUpdate = unlisten;
    zoomIndex.value = 5; //感觉默认改到80%好一点
  } catch (err) {
    await showError("注册 URL 监听失败:", err);
  }
});

onUnmounted(() => {
  mounted = false;
  unlistenViewUpdate?.();
  if (unlistenUrlUpdate) {
    unlistenUrlUpdate();
    unlistenUrlUpdate = null;
  }
});
</script>

<template>
  <div class="body">
    <div class="navigation">
      <VButton
        :icon="ArrowIcon"
        :disabled="courseControlsDisabled || !canGoBack || isNavigating"
        color="var(--theme-surface-accent)"
        shape="circle"
        size="20%"
        variant="translucent"
        class="back-btn"
        @click="handleGoBack"
      />
      <VButton
        :icon="ArrowIcon"
        :disabled="courseControlsDisabled || !canGoForward || isNavigating"
        color="var(--theme-surface-accent)"
        shape="circle"
        size="20%"
        variant="translucent"
        @click="handleGoForward"
      />
      <VButton
        :icon="RefreshIcon"
        data-action="reload"
        :disabled="courseControlsDisabled || isNavigating"
        color="var(--theme-surface-accent)"
        shape="circle"
        size="20%"
        variant="translucent"
        @click="handleReload"
      />
      <VButton
        :icon="HomeIcon"
        :disabled="courseControlsDisabled || isNavigating"
        color="var(--theme-surface-accent)"
        shape="circle"
        size="20%"
        variant="translucent"
        @click="handleGoHome"
      />
    </div>
    <div class="capsule-slot">
      <VRollTransition
        v-slot="{ value }"
        :value="displayedUrl"
        class="url-display"
      >
        <p class="url-text">{{ value }}</p>
      </VRollTransition>
      <VButton
        :icon="ZoomOutIcon"
        :disabled="courseControlsDisabled || !canZoomOut"
        color="var(--theme-brand)"
        shape="circle"
        size="1.75rem"
        variant="translucent"
        @click="zoomOut"
      />
      <span class="zoom-value">{{
        currentView === "chaoxing" ? currentZoomText : "—"
      }}</span>
      <VButton
        :icon="ZoomInIcon"
        :disabled="courseControlsDisabled || !canZoomIn"
        color="var(--theme-brand)"
        shape="circle"
        size="1.75rem"
        variant="translucent"
        @click="zoomIn"
      />
    </div>
    <div class="title">
      <VRollTransition
        v-slot="{ value }"
        :value="currentView === 'deepseek' ? 'DeepSeek' : label('coursePage')"
        class="page-title"
      >
        {{ value }}
      </VRollTransition>
    </div>
  </div>
</template>
<style scoped>
.page-title {
  width: 100%;
  height: 1.5em;
}
.page-title :deep(.roll-item) {
  justify-content: center;
}
.body {
  background-color: var(--theme-brand);
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-end;
}

.navigation {
  width: 22.5%;
  height: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 0 1%;
  box-sizing: border-box;
  margin-right: auto;
}

:deep(.navigation .icon-svg) {
  transform: scale(1.25);
}

:deep(.back-btn .icon-svg) {
  transform: rotate(180deg) scale(1.25);
}

.url-display {
  width: 70%;
  height: 100%;
  min-width: 0;
  margin-right: auto;
}

.url-text {
  width: 100%;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis; /* 超出部分显示省略号 ... */
  white-space: nowrap; /* 强制单行，禁止换行 */
  font-size: 1rem;
  color: var(--theme-brand-deep);
  user-select: text;
}

.zoom-value {
  width: 7.5%;
  text-align: center;
  font-size: 0.85rem;
}

.capsule-slot {
  height: 75%;
  flex: 1;
  min-width: 0;
  background: var(--theme-page-gradient);
  border-radius: 999px;
  display: flex;
  align-items: center;
  overflow: hidden;
  padding: 0 2%;
  gap: 8px;
  border: 2px solid var(--theme-brand-deep);
  box-shadow: inset 0 2px 4px
    color-mix(in srgb, var(--theme-black) 25%, transparent);
}

.title {
  font-size: larger;
  width: 15%;
  color: var(--theme-surface-accent);
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>

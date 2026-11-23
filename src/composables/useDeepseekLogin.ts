import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  commands,
  type ActiveView,
  type Authentication,
} from "@/services/cmds";
import { showError } from "@/services/errors";
import { translated } from "@/labels";

/** One visible configuration page owns one bounded login guide, not the solver. */
export function useDeepseekLogin(enabled: () => boolean) {
  const status = ref<Authentication["status"]>("checking");
  const diagnostic = ref<string | null>(null);
  const view = ref<ActiveView | null>(null);
  const pending = ref(0);
  const busy = computed(() => pending.value > 0);
  let epoch = 0;
  let disposed = false;
  let started = false;
  let guided = false;
  let guideDeadline = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unlisten: UnlistenFn | undefined;
  let switches = Promise.resolve();
  let viewRevision = 0;
  const current = (token: number) => !disposed && enabled() && token === epoch;

  function clearTimer() {
    clearTimeout(timer);
    timer = undefined;
  }

  async function syncView() {
    const revision = viewRevision;
    const actual = await commands.currentWebview();
    if (!disposed && revision === viewRevision) view.value = actual;
  }

  function switchView(target: ActiveView, token: number, restore = false) {
    pending.value++;
    const operation = switches.then(async () => {
      if (!restore && !current(token)) {
        pending.value--;
        return false;
      }
      try {
        const result = await (target === "deepseek"
          ? commands.activateDeepseekView()
          : commands.activateChaoxingView());
        if (!disposed) {
          ++viewRevision;
          view.value = result.view;
        }
        if (result.focusError && current(token)) {
          void showError(
            translated(
              "View switched; focus request failed",
              "视图已切换，焦点请求失败",
            ),
            result.focusError,
          );
        }
        return restore || current(token);
      } catch (error) {
        // A response can be lost after native commit. Keep the real view on
        // partial failure; queued restores still run after this operation.
        try {
          await syncView();
        } catch (syncError) {
          view.value = null;
          console.error("同步 WebView 层级失败", syncError);
        }
        throw error;
      } finally {
        pending.value--;
      }
    });
    // Recover only the queue tail; the returned operation still reports errors.
    switches = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }

  function failed(token: number, cause: unknown) {
    if (!current(token)) return;
    status.value = "unknown";
    diagnostic.value = cause instanceof Error ? cause.message : String(cause);
  }

  function schedule(token: number, deadline: number, delay: number) {
    timer = setTimeout(() => {
      void check(token, deadline);
    }, delay);
  }

  async function check(token: number, checkingDeadline: number) {
    try {
      const result = await commands.deepseekAuthentication();
      if (!current(token)) return;
      status.value = result.status;
      diagnostic.value = result.diagnostic;
      if (result.status === "checking") {
        if (Date.now() >= checkingDeadline) {
          failed(
            token,
            translated(
              "Page is not ready. Retry when it finishes loading.",
              "页面尚未就绪，请加载完成后重试。",
            ),
          );
        } else schedule(token, checkingDeadline, 1000);
      } else if (result.status === "unauthenticated") {
        if (!guided) {
          if (!(await switchView("deepseek", token))) return;
          guided = true;
          guideDeadline = Date.now() + 5 * 60_000;
        }
        if (!current(token)) return;
        if (Date.now() >= guideDeadline) {
          failed(
            token,
            translated(
              "Login check paused. Retry to continue.",
              "登录检查已暂停，请重试以继续。",
            ),
          );
        } else schedule(token, guideDeadline, 2000);
      } else if (result.status === "authenticated" && guided) {
        // Consume the guide before awaiting native work. Repeated auth results
        // must never hide a page that the user subsequently opens manually.
        guided = false;
        await switchView("chaoxing", token);
      }
    } catch (error) {
      failed(token, error);
    }
  }

  function retry() {
    if (!enabled() || disposed) return;
    clearTimer();
    const token = ++epoch;
    status.value = "checking";
    diagnostic.value = null;
    if (guided) guideDeadline = Date.now() + 5 * 60_000;
    void syncView()
      .then(() => {
        if (current(token)) return check(token, Date.now() + 15_000);
      })
      .catch((error) => failed(token, error));
  }

  async function toggle() {
    if (!enabled() || status.value !== "authenticated" || busy.value) return;
    const token = epoch;
    try {
      await switchView(
        view.value === "deepseek" ? "chaoxing" : "deepseek",
        token,
      );
    } catch (error) {
      if (current(token))
        void showError(translated("View switch failed", "切换网页失败"), error);
    }
  }

  function stop() {
    ++epoch;
    clearTimer();
    guided = false;
    diagnostic.value = null;
    status.value = "checking";
    if (started) {
      started = false;
      // This restore is enqueued even if an earlier activation is still in IPC.
      // A new selection queues its own actions after it, so old work cannot win.
      void switchView("chaoxing", epoch, true).catch((error) => {
        console.error("恢复课程页面失败", error);
        if (!disposed)
          void showError(
            translated("Unable to restore the course page", "恢复课程页面失败"),
            error,
          );
      });
    }
  }

  watch(
    enabled,
    (active) => {
      if (active) {
        started = true;
        guided = false;
        retry();
      } else stop();
    },
    { immediate: true, flush: "sync" },
  );

  onMounted(async () => {
    const release = await listen<ActiveView>(
      "active-webview-changed",
      (event) => {
        if (!disposed) {
          ++viewRevision;
          view.value = event.payload;
        }
      },
    );
    if (disposed) release();
    else unlisten = release;
  });
  onUnmounted(() => {
    stop();
    disposed = true;
    unlisten?.();
  });

  return { status, diagnostic, view, busy, retry, toggle };
}

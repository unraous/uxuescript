import { afterEach, expect, it, vi } from "vitest";
import { emitTo } from "@tauri-apps/api/event";
import { syncSolverScrollbar } from "@/theme";

vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn(), listen: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each([false, true])(
  "syncs the solver palette only after a color transition settles (cancelled=%s)",
  async (cancelled) => {
    let settle!: () => void;
    const finished = new Promise<void>((resolve, reject) => {
      settle = () => (cancelled ? reject(new Error("cancelled")) : resolve());
    });
    vi.stubGlobal("document", {
      documentElement: { getAnimations: () => [{ finished }] },
    });

    const pending = syncSolverScrollbar();
    await Promise.resolve();
    expect(emitTo).not.toHaveBeenCalled();

    settle();
    await pending;
    expect(emitTo).toHaveBeenCalledExactlyOnceWith(
      "app",
      "theme-colors-changed",
      null,
    );
  },
);

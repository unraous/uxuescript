import { flushPromises, shallowMount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TheMainLayout from "@/layouts/TheMainLayout.vue";
import appConfig from "../../src-tauri/tauri.conf.json";

const mocks = vi.hoisted(() => ({
  once: vi.fn(),
  unlisten: vi.fn(),
  check: vi.fn(),
  finished: undefined as (() => void) | undefined,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ once: mocks.once }),
}));
vi.mock("@/services/updater", () => ({
  checkForUpdates: mocks.check,
}));
vi.mock("@/components/TheMenuBar.vue", () => ({
  default: { template: "<div/>" },
}));
vi.mock("@/components/TheBottomBar.vue", () => ({
  default: { template: "<div/>" },
}));
vi.mock("@/layouts/TheLeftLayout.vue", () => ({
  default: { template: "<div/>" },
}));
vi.mock("@/layouts/TheRightLayout.vue", () => ({
  default: { template: "<div/>" },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.finished = undefined;
  mocks.once.mockImplementation(async (_event, callback) => {
    mocks.finished = callback;
    return mocks.unlisten;
  });
});

describe("startup update check", () => {
  it("checks only after the mask reports startup completion", async () => {
    const wrapper = shallowMount(TheMainLayout);
    await flushPromises();
    expect(mocks.once).toHaveBeenCalledWith(
      "startup-finished",
      expect.any(Function),
    );
    expect(mocks.check).not.toHaveBeenCalled();
    mocks.finished?.();
    await flushPromises();
    expect(mocks.check).toHaveBeenCalledWith(appConfig.version);
    wrapper.unmount();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands } from "@/services/cmds";
import { showError } from "@/services/errors";
import { useUpdater } from "@/composables/useUpdater";

const mocks = vi.hoisted(() => ({ closeResource: vi.fn(async () => {}) }));

vi.mock("@tauri-apps/api/core", () => ({
  Resource: class {
    close() {
      return mocks.closeResource();
    }
  },
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/services/errors", () => ({ showError: vi.fn() }));
vi.mock("@/services/cmds", () => ({
  commands: {
    checkUpdate: vi.fn<typeof commands.checkUpdate>(),
    platform: vi.fn<typeof commands.platform>(),
    isMsiInstall: vi.fn<typeof commands.isMsiInstall>(),
    confirm: vi.fn<typeof commands.confirm>(),
    downloadUpdate: vi.fn<typeof commands.downloadUpdate>(),
  },
}));

const update = { rid: 42, version: "2.2.0", body: "release notes" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(commands.checkUpdate).mockResolvedValue(update);
  vi.mocked(commands.platform).mockResolvedValue("windows");
  vi.mocked(commands.isMsiInstall).mockResolvedValue(true);
  vi.mocked(commands.confirm).mockResolvedValue(false);
  vi.mocked(commands.downloadUpdate).mockResolvedValue(true);
  mocks.closeResource.mockResolvedValue();
});

describe("useUpdater", () => {
  it("does not prompt when no update exists", async () => {
    vi.mocked(commands.checkUpdate).mockResolvedValue(null);
    await useUpdater().checkForUpdates("2.1.4");
    expect(commands.confirm).not.toHaveBeenCalled();
  });

  it("logs check failures without showing the update dialog", async () => {
    const error = new Error("failed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(commands.checkUpdate).mockRejectedValue(error);
    await useUpdater().checkForUpdates("2.1.4");
    expect(commands.confirm).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("检查更新失败", error);
    warn.mockRestore();
  });

  it("releases a declined update resource", async () => {
    await useUpdater().checkForUpdates("2.1.4");
    expect(commands.confirm).toHaveBeenCalledWith(
      expect.stringContaining("v2.2.0"),
      null,
    );
    expect(commands.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.closeResource).toHaveBeenCalledOnce();
  });

  it("opens the release page for a portable Windows installation", async () => {
    vi.mocked(commands.isMsiInstall).mockResolvedValue(false);
    vi.mocked(commands.confirm).mockResolvedValue(true);
    await useUpdater().checkForUpdates("2.1.4");
    expect(openUrl).toHaveBeenCalledWith(
      "https://github.com/unraous/uxuescript/releases/latest",
    );
    expect(commands.downloadUpdate).not.toHaveBeenCalled();
    expect(mocks.closeResource).toHaveBeenCalledOnce();
  });

  it.each(["windows", "macos"])(
    "downloads the update on %s and relaunches only on macOS",
    async (platform) => {
      vi.mocked(commands.platform).mockResolvedValue(platform);
      let confirmationFinished = false;
      vi.mocked(commands.confirm).mockImplementation(async () => {
        confirmationFinished = true;
        return true;
      });
      vi.mocked(commands.downloadUpdate).mockImplementation(async (rid) => {
        expect(confirmationFinished).toBe(true);
        expect(rid).toBe(42);
        return true;
      });
      await useUpdater().checkForUpdates("2.1.4");
      expect(commands.downloadUpdate).toHaveBeenCalledWith(42);
      expect(relaunch).toHaveBeenCalledTimes(platform === "macos" ? 1 : 0);
      expect(mocks.closeResource).toHaveBeenCalledOnce();
    },
  );

  it.each(["windows", "macos"])(
    "does not relaunch or show an error after cancelling a download on %s",
    async (platform) => {
      vi.mocked(commands.platform).mockResolvedValue(platform);
      vi.mocked(commands.confirm).mockResolvedValue(true);
      vi.mocked(commands.downloadUpdate).mockResolvedValue(false);
      await useUpdater().checkForUpdates("2.1.4");
      expect(relaunch).not.toHaveBeenCalled();
      expect(showError).not.toHaveBeenCalled();
      expect(mocks.closeResource).toHaveBeenCalledOnce();
    },
  );

  it("shows an error if download or installation fails", async () => {
    const error = new Error("update failed");
    vi.mocked(commands.platform).mockResolvedValue("macos");
    vi.mocked(commands.confirm).mockResolvedValue(true);
    vi.mocked(commands.downloadUpdate).mockRejectedValue(error);
    await useUpdater().checkForUpdates("2.1.4");
    expect(relaunch).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith("下载或安装更新失败：", error);
    expect(mocks.closeResource).toHaveBeenCalledOnce();
  });
});

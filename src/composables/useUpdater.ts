import { Resource } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { commands } from "@/services/cmds";
import { showError } from "@/services/errors";
import config from "../../config/build.json";

export function useUpdater() {
  async function checkForUpdates(currentVersion: string) {
    let update: Awaited<ReturnType<typeof commands.checkUpdate>>;
    let resource: Resource | undefined;
    let acceptedUpdate = false;
    try {
      update = await commands.checkUpdate();
      if (!update) return;
      resource = new Resource(update.rid);

      const platform = await commands.platform();
      const isMsiInstall = await commands.isMsiInstall();
      const manualDownload = platform === "windows" && isMsiInstall === false;
      const accepted = await commands.confirm(
        `发现新版本 v${update.version}（当前版本 v${currentVersion}），${manualDownload ? "前往下载页面吗？" : "现在下载安装吗？"}${update.body ? `\n\n${update.body}` : ""}`,
        null,
      );
      if (!accepted) return;
      acceptedUpdate = true;

      if (manualDownload) {
        await openUrl(config.updater.release_url);
        return;
      }

      const installed = await commands.downloadUpdate(update.rid);
      if (installed && platform === "macos") await relaunch();
    } catch (error) {
      if (acceptedUpdate) {
        await showError("下载或安装更新失败：", error);
      } else {
        console.warn("检查更新失败", error);
      }
    } finally {
      try {
        await resource?.close();
      } catch (error) {
        console.warn("释放更新检查资源失败", error);
      }
    }
  }

  return { checkForUpdates };
}

# 发布与镜像

发布入口是 [Release 工作流](../../.github/workflows/release.yml)。推送 `v*` 标签后，先运行共享 CI，再构建 Windows x64 MSI/便携 EXE 与 macOS ARM64 DMG/更新包，发布到 GitHub Release，最后同步 Gitee。

同次发布还会上传 `dist/scripts/core.js` 与 `dist/scripts/uxuescript.user.js` 两份可读脚本，并随其他附件同步至 Gitee。源码在 `injected/`，由 `pnpm build:scripts` 打包为可直接复制执行的单文件；油猴版给课程脚本添加元数据，版本读取 `config/build.json`。桌面端内嵌 `dist/scripts/embedded/` 中的压缩脚本，不作为独立附件上传。当前不接入脚本站自动发布。

## 发布准备

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 配置：

| Secret | 用途 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | 与 `config/build.json` 中更新公钥配套的私钥 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码；无密码可留空 |
| `GITEE_TOKEN` | 对目标 Gitee 仓库、标签和发行版有写权限的令牌，用于标签推送与 Release API |

发布步骤：

1. 修改 `config/build.json` 的版本，运行 `pnpm sync:config`。
2. 完成[构建指南](build.md)中的基础检查；安装并验证生成的安装包，覆盖开屏、课程页登录、模型配置保存和正常退出。更新安装流程可用[本地更新测试](../../tests/updater/README.md)验证。
3. 在 `.github/release-notes/` 下编写对应 `v<版本>.md`，说明本次用户可见变化。
4. 检查并提交发布所需改动，推送 GitHub，再创建并推送与配置一致的 `v<版本>` 标签。

CI 会核对标签与同步后的 Cargo 版本，不匹配则失败。macOS 安装包和更新包会校验应用签名完整性；临时签名不等于 Apple 公证。

## Gitee 镜像

[`sync-gitee-release.mjs`](../../scripts/sync-gitee-release.mjs) 从已发布的 GitHub Release 获取说明与附件，将同一份安装包、更新包和签名同步到 Gitee，不重新构建。

同步前核对标签指向，遇到不同提交会失败而不强推。同名附件会被替换，其他附件保留；上传后核对文件名与大小。同步失败不会撤销 GitHub Release。

GitHub 的 `latest.json` 是分发基准。Gitee 清单使用已上传附件的实际地址，保留版本、说明、时间和签名。最新正式版本的清单还写入 Gitee `updates` 分支；旧版重试或预览版同步不会覆盖正式版本清单，没有更新清单的旧发行版仅同步附件。

手动重试镜像：进入 **Actions → Release → Run workflow**，选择含有同步脚本的 `main`，在 `release_tag` 填写已发布标签。此入口只同步 Gitee，不重新构建或发布 GitHub；缺少令牌时先补齐上述 Secret。

## 发布后核对

- 确认 GitHub 与 Gitee 的目标版本、附件和更新清单一致，签名仍对应原更新包。
- 确认 Gitee 附件可实际下载；本地 mock 不验证镜像服务的大小限制和上传行为。
- 更新端点按 Gitee、GitHub 顺序检查；选中清单后的下载失败不会自动改用另一个端点。不要把镜像同步成功等同于客户端升级成功。

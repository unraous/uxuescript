<script setup lang="ts">
import { openUrl } from "@tauri-apps/plugin-opener";

const openIssues = async () => {
  try {
    await openUrl("https://github.com/unraous/uxuescript/issues");
  } catch (error) {
    console.error("无法打开 GitHub Issues 页面:", error);
  }
};
</script>

<template>
  <div class="guide-panel">
    <h1 class="title">User Guide</h1>
    <div class="guide-content custom-scrollbar">
      <p>
        使用前，请在 Configuration 中选择适合的模型供应商与模型，并填写 API
        Key。
      </p>
      <p>
        随后前往右下角的课程页面，登录并打开目标课程；在弹窗中确认后即可启动。
      </p>
      <p>
        本项目为开源非营利项目，仅供学习与技术交流。请遵守相关平台规则，使用风险和责任由使用者自行承担。
      </p>
      <p>
        当前版本仍处于重构与快速迭代阶段，并非长期稳定版本。遇到问题时，请先确认是否已更新至最新版本。
      </p>
      <p>
        作者并非学习通长期用户，测试课程资源有限，部分特殊课程尚未充分验证，可能存在兼容性问题。若更新至最新版本后问题仍未解决，欢迎在
        <a
          href="https://github.com/unraous/uxuescript/issues"
          @click.prevent="openIssues"
          >GitHub Issues</a
        >
        提交反馈，或联系作者：
        <a href="mailto:unraous@qq.com">unraous@qq.com</a>。
      </p>
    </div>
  </div>
</template>

<style scoped>
.guide-panel {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
}

.title {
  height: 20%;
  width: 100%;
  font-size: 2rem;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.guide-content {
  height: 60%;
  width: 90%;
  display: flex;
  flex-direction: column;
  text-align: center;
  gap: 16px;
  padding: 0 10%;
  color: #0d58a4;
  font-size: 1.25rem;
  line-height: 1.5;
  overflow-y: auto;
  overscroll-behavior-y: contain;
}

.guide-content p {
  margin: 0;
}

.guide-content a {
  color: inherit;
}
</style>

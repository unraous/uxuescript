<script setup lang="ts">
import { openUrl } from "@tauri-apps/plugin-opener";
import { showError } from "@/services/errors";
import { label } from "@/labels";
import VRollTransition from "@/components/base/VRollTransition.vue";

const openIssues = async () => {
  try {
    await openUrl("https://github.com/unraous/uxuescript/issues");
  } catch (error) {
    await showError("无法打开 GitHub Issues 页面:", error);
  }
};
</script>

<template>
  <article
    class="guide-panel"
    aria-labelledby="guide-title"
  >
    <h1
      id="guide-title"
      class="title"
    >
      <VRollTransition v-slot="{ value }" :value="label('userGuide')" class="title-text">
        {{ value }}
      </VRollTransition>
    </h1>
    <div class="guide-content custom-scrollbar">
      <section aria-labelledby="guide-steps-title">
        <h2 id="guide-steps-title">操作步骤</h2>
        <ol>
          <li>
            <strong>配置模型：</strong>在 Configuration
            → API 中选择供应商与模型，填写所需密钥并保存。仅处理视频、音频和 PDF 可跳过。
          </li>
          <li>
            <strong>打开学习页面：</strong
            >在右下角登录学习通，进入目标课程章节、作业或受支持的考试答题页。
          </li>
          <li><strong>确认启动：</strong>阅读页面提示，点击 Yes 启动，No 取消。</li>
          <li>
            <strong>停止运行：</strong>使用课程控制栏的刷新或 Home；刷新后课程任务需重新确认启动。
          </li>
        </ol>
        <p>
          视频批注出现时会自动点击“继续学习”，无需配置模型或手动操作。
        </p>
      </section>
      <section aria-labelledby="guide-answering-title">
        <h2 id="guide-answering-title">作业与考试</h2>
        <p>
          独立作业：自动填写整页并暂存，完成后请检查并自行提交。
        </p>
        <p>
          可整卷预览的考试：自动进入预览页，确认后填写整卷，请自行检查、保存并交卷。
        </p>
        <p>
          不允许整卷预览的考试：从第一题启动，先逐题采集整卷，求解后返回首题填写并暂存。
          运行时不要手动跳题；刷新同一题可继续当前窗口中保存的步骤，报错后需从第一题重新启动。
        </p>
        <p>
          逐题模式仅支持允许自由回看的普通考试；限制回看、单题或分组限时等模式不支持。
          脚本不自动交卷，平台倒计时及到时自动提交仍按原有规则运行。
        </p>
        <p>
          作业与考试支持单选、多选、判断、填空、简答和连线题，结束提示中列出的未支持题型需人工处理。
          Review Answers 仅控制章节测验的提交前核验。
        </p>
      </section>
      <section aria-labelledby="guide-issues-title">
        <h2 id="guide-issues-title">常见问题</h2>
        <p>
          倍速后任务不完成或不跳转：部分课程按观看时长解锁，请将 Speed Lock
          留空，以原速重试。
        </p>
        <p>
          最小化后视频暂停：部分电脑会冻结课程页，可保持窗口不最小化，用 Alt+Tab
          切换应用。
        </p>
        <p>
          答题等待较久：若日志出现 429，表示服务限流，程序会自动等待并改用串行请求重试。
          请先等待结果；重试后仍失败，可稍后重新启动或更换模型、供应商。
        </p>
        <p>
          提示答案格式错误或不完整：程序会自动重试失败批次；仍失败时，本次不回填或提交。
          请保留报错中的失败原因，检查模型配置后重试。
        </p>
      </section>
      <section aria-labelledby="guide-notes-title">
        <h2 id="guide-notes-title">使用说明</h2>
        <p>
          本项目为开源非营利项目，仅供学习与技术交流。请遵守相关平台规则，使用风险和责任由使用者自行承担。
        </p>
        <p>当前版本仍处于重构与快速迭代阶段，并非长期稳定版本。</p>
        <p>
          作者并非学习通长期用户，测试课程资源有限，部分特殊课程尚未充分验证，可能存在兼容性问题。
        </p>
      </section>
      <section aria-labelledby="guide-feedback-title">
        <h2 id="guide-feedback-title">问题反馈</h2>
        <p>
          遇到问题时，请先更新至最新版本。若问题仍未解决，可在
          <a
            href="https://github.com/unraous/uxuescript/issues"
            @click.prevent="openIssues"
            >GitHub Issues</a
          >
          提交反馈，或通过邮件联系作者：
          <a href="mailto:unraous@qq.com">unraous@qq.com</a>。
        </p>
      </section>
    </div>
  </article>
</template>

<style scoped>
.guide-panel {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  text-align: left;
  -webkit-text-stroke: 0;
  /* 全局字体仅提供常规字重，此处允许合成粗体以呈现标题和步骤层级。 */
  font-synthesis: weight;
}

.title {
  height: 20%;
  width: 100%;
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--theme-brand);
}

.title-text {
  width: 100%;
  height: 1.5em;
}

.title-text :deep(.roll-item) {
  justify-content: center;
}

.guide-content {
  height: 60%;
  width: 90%;
  min-height: 0;
  padding: 0 10%;
  color: var(--theme-brand);
  font-size: 1.25rem;
  line-height: 1.5;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  overflow-wrap: anywhere;
  user-select: text;
}

.guide-content section + section {
  margin-top: 1rem;
  padding-top: 1rem;
}

.guide-content h2 {
  margin: 0 0 0.5rem;
  color: var(--theme-brand);
  font-size: inherit;
  font-weight: 700;
  line-height: 1.5;
}

.guide-content strong {
  font-weight: 700;
}

.guide-content ol {
  margin: 0;
  padding-left: 1.5em;
}

.guide-content li + li,
.guide-content p + p {
  margin-top: 0.5rem;
}

.guide-content p {
  margin: 0;
}

.guide-content a {
  color: var(--theme-brand);
  text-underline-offset: 0.15em;
}
</style>

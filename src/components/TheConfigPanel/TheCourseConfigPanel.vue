<script setup lang="ts">
import { onMounted, ref } from "vue";
import VInput from "@/components/base/VInput.vue";
import VToggle from "@/components/base/VToggle.vue";
import { commands, type OptionsConfig } from "@/services/cmds";
import { useConfig } from "@/composables/useConfig";
import { boolean, optionalPositiveNumber } from "@/composables/useConfig/schemas";
import { label } from "@/labels";

const options = ref<OptionsConfig>();
const lockSpeed = ref("");
const switchingCd = ref("");
const { load, saveField } = useConfig(
  commands.options,
  (config) => {
    options.value = config;
    lockSpeed.value = String(config.lockSpeed ?? "");
    switchingCd.value = String(config.switchingCd ?? "");
  },
  "课程配置操作失败:",
);
onMounted(load);
</script>

<template>
  <div class="course-config-panel">
    <div
      v-if="options"
      class="settings-container"
    >
      <VToggle
        :model-value="options.muteWebview ?? false"
        :label="label('muteCourse')"
        annotation="开启后，课程视频会自动静音；关闭后，视频声音由课程页面控制。"
        class="option"
        @update:model-value="
          saveField(commands.setOptions, 'muteWebview', $event, boolean)
        "
      />
      <VToggle
        id="quiz-review-toggle"
        :model-value="options.quizReview ?? false"
        :label="label('quizReview')"
        annotation="提交测验前先人工核验答案。点击 Yes 立即提交；点击 No 会留出 30 秒检查或修改答案，再次询问。如需停止脚本，请点击左上角的刷新或 Home。"
        class="option"
        @update:model-value="
          saveField(commands.setOptions, 'quizReview', $event, boolean)
        "
      />
      <VInput
        id="playing-speed-input"
        v-model="lockSpeed"
        pattern="[0-9]*([.][0-9]*)?"
        placeholder="例如 2 表示两倍速，留空不调整"
        :label="label('lockPlayspeed')"
        annotation="填写想要的视频播放倍速，例如填 2 就按两倍速播放。播放时会保持这个倍速，不让课程页面改回去。留空则不调整视频倍速。"
        class="option speed-input"
        @change="
          saveField(
            commands.setOptions,
            'lockSpeed',
            lockSpeed,
            optionalPositiveNumber,
          )
        "
      />
      <VInput
        id="switching-cd-input"
        v-model="switchingCd"
        pattern="[0-9]*([.][0-9]*)?"
        placeholder="单位：秒，留空不额外等待"
        :label="label('switchingCd')"
        annotation="每次填题、开始任务或发送互动题的答案验证请求前，先等待这里设置的秒数。例如填 2，每次会随机等待 1.5～2.5 秒。留空则不额外等待。"
        class="option speed-input"
        @change="
          saveField(
            commands.setOptions,
            'switchingCd',
            switchingCd,
            optionalPositiveNumber,
          )
        "
      />
    </div>
  </div>
</template>

<style scoped>
.course-config-panel {
  height: 100%;
  flex: 1;
  flex-direction: column;
  display: flex;
}
.settings-container {
  flex: 1;
  display: flex;
  gap: 5%;
  flex-direction: column;
}
.option {
  height: 20%;
}
.speed-input :deep(.input-field) {
  text-align: center;
}
</style>

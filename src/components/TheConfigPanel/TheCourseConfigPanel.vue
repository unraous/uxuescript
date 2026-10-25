<script setup lang="ts">
import { onMounted, ref } from "vue";
import VInput from "@/components/base/VInput.vue";
import VToggle from "@/components/base/VToggle.vue";
import { commands, type OptionsConfig } from "@/services/cmds";
import { showError } from "@/services/errors";
import { label } from "@/labels";

const options = ref<OptionsConfig>();
const lockSpeed = ref("");
const switchingCd = ref("");
const saveNumber = (key: "lockSpeed" | "switchingCd", input: string) => {
  const value = input.trim() === "" ? null : Number(input);
  if (value !== null && (!Number.isFinite(value) || value <= 0)) {
    showError(
      "保存课程配置失败:",
      new Error("请输入大于零的数字，或留空关闭。"),
    );
    return;
  }
  options.value![key] = value;
  saveOptions();
};
const saveOptions = () =>
  commands
    .setOptions(options.value!)
    .catch((cause) => showError("保存课程配置失败:", cause));

onMounted(async () => {
  options.value = await commands.options();
  lockSpeed.value = String(options.value.lockSpeed ?? "");
  switchingCd.value = String(options.value.switchingCd ?? "");
});
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
          options.muteWebview = $event;
          saveOptions();
        "
      />
      <VToggle
        id="quiz-review-toggle"
        :model-value="options.quizReview ?? true"
        :label="label('quizReview')"
        annotation="默认只提供参考答案；自动填写和自动提交需要任务级授权。开启本项时，提交前还会再次人工确认；关闭也只影响授权练习，正式/计分任务仍不会自动提交。"
        class="option"
        @update:model-value="
          options.quizReview = $event;
          saveOptions();
        "
      />
      <VInput
        id="playing-speed-input"
        v-model="lockSpeed"
        placeholder="例如 2 表示两倍速，留空不调整"
        :label="label('lockPlayspeed')"
        annotation="填写想要的视频播放倍速，例如填 2 就按两倍速播放。播放时会保持这个倍速，不让课程页面改回去。留空则不调整视频倍速。"
        class="option speed-input"
        @change="saveNumber('lockSpeed', lockSpeed)"
      />
      <VInput
        id="switching-cd-input"
        v-model="switchingCd"
        placeholder="单位：秒，留空不额外等待"
        :label="label('switchingCd')"
        annotation="每次填题、开始任务或发送互动题的答案验证请求前，先等待这里设置的秒数。例如填 2，每次会随机等待 1.5～2.5 秒。留空则不额外等待。"
        class="option speed-input"
        @change="saveNumber('switchingCd', switchingCd)"
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

<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  type CourseStatus,
  type CourseMetadata,
  type ChapterProgressPayload,
  type TabProgressPayload,
  type TaskProgressPayload,
  commands,
} from "@/services/cmds";
import TheCourseCover from "./TheCourseCover.vue";
import TheCourseProgressBar from "./TheCourseProgressBar.vue";
import VRollTransition from "@/components/base/VRollTransition.vue";
import { showError } from "@/services/errors";

interface CourseInfo {
  state: "loading" | "executing" | "finished";
  metadata: CourseMetadata;
  chapter: ChapterProgressPayload;
  tab: TabProgressPayload;
  task: TaskProgressPayload;
}

const initialCourseInfo = (): CourseInfo => ({
  state: "loading",
  metadata: { title: "课程待加载", cover: "" },
  chapter: { title: "章节待加载", index: 0, completed: 0, total: 0 },
  tab: { index: 0, total: 0 },
  task: { index: 0, category: "" },
});

const courseInfo = ref<CourseInfo>(initialCourseInfo());

const chapterProgress = computed(() => {
  const { completed, total } = courseInfo.value.chapter;
  return total > 0 ? Math.round((completed / total) * 100) : 0;
});

let taskInfoText = computed(() => {
  switch (courseInfo.value.state) {
    case "loading":
      return "任务点待加载";
    case "executing":
      return `本章节第 ${courseInfo.value.tab.index + 1} - ${courseInfo.value.task.index + 1} 任务点：${courseInfo.value.task.category ?? ""}`;
    default:
      return "所有任务点均已完成";
  }
});

const queryCourseMeta = async (): Promise<CourseMetadata> => {
  const url = await commands.currentUrl();
  const courseId = url ? new URL(url).searchParams.get("courseId") : null;
  const meta = courseId ? await commands.queryCourseMeta(courseId) : null;
  return meta ?? { title: "", cover: "" };
};

const handleStatusChange = async (status: CourseStatus) => {
  switch (status.kind) {
    case "start":
      courseInfo.value.state = "executing";
      courseInfo.value.metadata = await queryCourseMeta();
      break;
    case "chapter":
      courseInfo.value.chapter = status.payload;
      break;
    case "tab":
      courseInfo.value.tab = status.payload;
      break;
    case "task":
      courseInfo.value.task = status.payload;
      break;
    case "cancel":
      courseInfo.value = initialCourseInfo();
      break;
    case "finish":
      console.log("课程已完成");
      courseInfo.value.state = "finished";
      break;
    default:
      console.error("不支持的课程状态：", status.kind);
      break;
  }
};

let unlistenStatus: UnlistenFn | null;
onMounted(async () => {
  try {
    unlistenStatus = await listen<CourseStatus>("status-update", (event) => {
      handleStatusChange(event.payload);
    });
  } catch (err) {
    await showError("注册 status-update 监听失败:", err);
  }
});

onUnmounted(() => {
  if (unlistenStatus) {
    unlistenStatus();
    unlistenStatus = null;
  }
});
</script>

<template>
  <div class="dashboard">
    <div class="content">
      <div class="cover-container">
        <TheCourseCover :cover-src="courseInfo.metadata.cover" />
      </div>
      <div class="info">
        <VRollTransition
          v-slot="{ value }"
          :value="courseInfo.metadata.title"
          class="text-displayer"
          style="font-size: 2rem"
        >
          <div class="text-content">{{ value }}</div>
        </VRollTransition>
        <VRollTransition
          v-slot="{ value }"
          :value="courseInfo.chapter.title"
          class="text-displayer"
          style="font-size: 1.5rem"
        >
          <div class="text-content">{{ value }}</div>
        </VRollTransition>
        <VRollTransition
          v-slot="{ value }"
          :value="taskInfoText"
          class="text-displayer"
          style="font-size: 1.25rem"
        >
          <div class="text-content">{{ value }}</div>
        </VRollTransition>
      </div>
    </div>
    <div class="progress-bar">
      <TheCourseProgressBar :progress="chapterProgress" />
      <div class="percentage">{{ chapterProgress }}%</div>
    </div>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
}

.content {
  height: 80%;
  display: flex;
  flex-direction: row;
}

.cover-container {
  width: 60%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.progress-bar {
  height: 20%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: row;
}

.info {
  width: 40%;
  height: 100%;
  display: flex;
  justify-content: center;
  flex-direction: column;
  text-align: right;
}

.text-displayer {
  width: 100%;
  height: 20%;
  padding-right: 15%;
}

.text-content {
  width: 100%;
  white-space: normal;
  word-break: break-all;
  overflow-wrap: break-word;
  line-height: 1.25;
  text-align: inherit;
}

.percentage {
  width: 10%;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>

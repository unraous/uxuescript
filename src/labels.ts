import { readonly, ref } from "vue";
import { commands, type LabelLanguage } from "@/services/cmds";
import type { ThemeName } from "@/theme";

const language = ref<LabelLanguage>("en");
export const labelLanguage = readonly(language);

const labels = {
  muteCourse: { en: "Mute Video", zh: "自动静音" },
  lockPlayspeed: { en: "Speed Lock", zh: "锁定倍速" },
  switchingCd: { en: "Delay", zh: "等待时间" },
  quizReview: { en: "Review Answers", zh: "人工核验" },
  provider: { en: "Provider", zh: "模型供应商" },
  model: { en: "Model", zh: "模型" },
  modelConcurrency: { en: "Concurrency", zh: "请求并发数" },
  modelBatchSize: { en: "Batch Size", zh: "每批题数" },
  endpoint: { en: "Endpoint", zh: "请求地址" },
  apiKey: { en: "API Key", zh: "API 密钥" },
  labelLanguage: { en: "Language", zh: "语言" },
  tabApi: { en: "API", zh: "模型" },
  tabCourse: { en: "Course", zh: "课程" },
  tabTheme: { en: "Theme", zh: "主题" },
  tabGeneral: { en: "General", zh: "通用" },
  configSections: { en: "Configuration sections", zh: "设置分类" },
  configuration: { en: "Configuration", zh: "配置" },
  confirmation: { en: "Confirmation", zh: "确认" },
  save: { en: "Save", zh: "保存" },
  testConnection: { en: "Test Connection", zh: "测试连接" },
  testing: { en: "Testing...", zh: "检测中···" },
  connectionFailed: { en: "Connection failed:", zh: "连接失败：" },
  connectionSuccess: {
    en: "Connection successful.\nThe model answered the test question.",
    zh: "连接成功。\n已收到模型对测试问题的有效回答，当前 API 与模型可正常用于答题。",
  },
  cancel: { en: "Cancel", zh: "取消" },
  create: { en: "New", zh: "新增" },
  edit: { en: "Edit", zh: "编辑" },
  remove: { en: "Delete", zh: "删除" },
  colorTheme: { en: "Color theme", zh: "配色主题" },
  userGuide: { en: "User Guide", zh: "使用指南" },
  coursePending: { en: "Pending . . .", zh: "课程待加载···" },
  chapterPending: { en: "Chapter not ready", zh: "章节待加载" },
  taskPending: { en: "Task not ready", zh: "任务点待加载" },
  tasksFinished: { en: "All done", zh: "所有任务点均已完成" },
  videoTask: { en: "Video", zh: "视频" },
  audioTask: { en: "Audio", zh: "音频" },
  pdfTask: { en: "Document", zh: "文档" },
  quizTask: { en: "Quiz", zh: "测验" },
  otherTask: { en: "Other", zh: "其他" },
  coursePage: { en: "Course", zh: "课程页面" },
  dataDirectory: { en: "Logs & Config", zh: "日志/配置目录" },
  languageDescription: {
    en: "认真的，你真的确定要改这个选项吗",
    zh: "好吧，这是你的自由",
  },
} as const;

const flowerNames = {
  gentian: { en: "Gentian", zh: "青嵐" },
  delphinium: { en: "Delphinium", zh: "翠雀" },
  camellia: { en: "Camellia", zh: "山茶" },
  gardenia: { en: "Gardenia", zh: "梔子" },
  iris: { en: "Iris", zh: "鳶尾" },
  dahlia: { en: "Dahlia", zh: "金蕊" },
  poppy: { en: "Jade Vine", zh: "碧蘿" },
  peony: { en: "Peony", zh: "胭脂" },
  wisteria: { en: "Wisteria", zh: "紫藤" },
  lotus: { en: "Lotus", zh: "蓮華" },
  hydrangea: { en: "Hydrangea", zh: "繡球" },
} satisfies Record<ThemeName, { en: string; zh: string }>;

export function translated(en: string, zh: string): string {
  return language.value === "en" ? en : zh;
}

export function themeLabel(name: ThemeName): string {
  return flowerNames[name][language.value];
}

export function label(key: keyof typeof labels): string {
  return labels[key][language.value];
}

export async function loadLabelLanguage() {
  const general = await commands.general();
  language.value = general.labelLanguage ?? "en";
  return general;
}

export async function setLabelLanguage(value: LabelLanguage) {
  const general = await commands.general();
  await commands.setGeneral({ ...general, labelLanguage: value });
  language.value = value;
}

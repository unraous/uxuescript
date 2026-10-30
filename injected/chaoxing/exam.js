import { config } from "@injected/chaoxing/runtime.js";
import { invoke, confirm } from "@injected/utils/backend.js";
import { answerPage } from "@injected/chaoxing/questions/page.js";
import { answerPaged } from "@injected/chaoxing/exam/paged.js";
import { SELECTORS } from "./selectors.js";

const page = /** @type {Window & typeof globalThis & {topreview(): void}} */ (
  window
);

/** 考试优先整卷预览，禁止预览时使用跨页采集和填写。 */
export const main = async () => {
  if (!invoke) {
    await confirm("未检测到后端，无法自动答题。");
    return;
  }
  try {
    if (window.location.pathname.endsWith("/mooc2/exam/preview")) {
      if (
        !(await confirm(
          "是否开始整卷答题？文本题将逐空暂存，填写完成后请检查并自行保存、交卷。\n\n请先选择可用的模型并测试连接。含图片的题目需要当前模型支持视觉输入，否则图片可能被忽略；模型答案可能有误，请人工核对。",
          { title: "考试开始", readSeconds: 5 },
        ))
      )
        return;
      await config.loadFromBackend();
      const skipped = await answerPage(document, SELECTORS.examPreview);
      await confirm(
        `答案已填写，请核对答案并自行保存、交卷；如有图片题，请确认当前模型具备视觉能力。\n\n如果发现大量题目未作答或未保存，可尝试在课程设置（Course）中调长等待时间（Delay），再重新填写；交卷前请检查并手动保存。${skipped.length ? `\n需人工处理的题号：${skipped.join("、")}` : ""}`,
        { title: "考试答题已完成", readSeconds: 5 },
      );
    } else if (
      document
        .querySelector(".mark_info")
        ?.textContent.includes("不允许整卷预览")
    ) {
      await answerPaged();
    } else {
      page.topreview();
    }
  } catch (error) {
    console.error("考试处理失败", error);
    await confirm(
      `考试处理失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

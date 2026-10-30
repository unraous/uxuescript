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
          "是否开始整卷答题？文本题将逐空暂存，填写完成后请检查并自行保存、交卷。\n\n含图片的题目需要当前模型支持视觉输入；否则图片可能被忽略，答案可能不准确。",
        ))
      )
        return;
      await config.loadFromBackend();
      const skipped = await answerPage(document, SELECTORS.examPreview);
      await confirm(
        `答案已填写，请核对答案并自行保存、交卷；如有图片题，请确认当前模型具备视觉能力！！${skipped.length ? `\n需人工处理的题号：${skipped.join("、")}` : ""}`,
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

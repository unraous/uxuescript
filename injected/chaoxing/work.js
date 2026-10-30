import { config } from "@injected/chaoxing/runtime.js";
import { wait } from "@injected/utils/async.js";
import { invoke, confirm } from "@injected/utils/backend.js";
import { answerPage } from "@injected/chaoxing/questions/page.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";
const page =
  /** @type {Window & typeof globalThis & {saveWork(options: {silentSuccess: boolean, success(): void, failure(data: {msg: string}): void}): void}} */ (
    window
  );

const saveWork = () =>
  new Promise((resolve, reject) => {
    page.saveWork({
      silentSuccess: true,
      success: () => resolve(undefined),
      failure: (data) => reject(new Error(data.msg)),
    });
  });

/**
 * 确认启动后提取整份作业、请求后端求解、填写并暂存，不自动提交。
 * @returns {Promise<void>}
 */
export const main = async () => {
  if (!invoke) {
    await confirm("未检测到后端，无法自动答题。");
    return;
  }
  /** @type {string[]} */
  let skipped;
  try {
    config.switchingCd = (await invoke("options")).switchingCd ?? null;
    if (
      !(await confirm(
        "是否开始作业答题？答案填写完成后将暂存，不会自动提交。\n\n含图片的题目需要当前模型支持视觉输入；否则图片可能被忽略，答案可能不准确。",
      ))
    )
      return;
    const form = await wait.element(null, SELECTORS.workExam.form, document);
    skipped = await answerPage(form, SELECTORS.workExam);
    await saveWork();
  } catch (error) {
    console.error("作业处理失败", error);
    await confirm(
      `作业处理失败：${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  await confirm(
    `答案已填写并暂存，请核对答案后自行提交；如有图片题，请确认当前模型具备视觉能力。\n\n如果发现大量题目未作答或未保存，可尝试在课程设置（Course）中调长等待时间（Delay），再重新填写；提交前请检查并手动保存。${skipped.length ? `\n需人工处理的题号：${skipped.join("、")}` : ""}`,
  );
};

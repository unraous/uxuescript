import { wait, assert } from "@injected/utils/async.js";
import { invoke } from "@injected/utils/backend.js";

/** @param {Document} taskDoc */
export const handleClassroom = async (taskDoc) => {
  const link = /** @type {HTMLAnchorElement} */ (
    await wait.element(null, "#classurl", taskDoc, "未找到课堂入口")
  );
  const url = await wait.until(() =>
    /^https?:\/\//.test(link.href) ? link.href : null,
  );
  assert(url, "等待课堂入口地址超时");
  if (await invoke("take_completed_task", { url })) return;
  await invoke("navigate_to_task", { url });
};

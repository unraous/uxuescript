import { invoke } from "@injected/utils/backend.js";
import { studyContext } from "@injected/chaoxing/runtime.js";
import { SELECTORS } from "@injected/chaoxing/selectors.js";

/**
 * 只采集已确认的页面背景；课程 ID 仅用于查缓存，不进入模型输入。
 * @param {Document} doc
 * @returns {Promise<import("../../../src/services/cmds").FolioContext>}
 */
export const readContext = async (doc) => {
  const context = { ...studyContext };
  const title = doc.querySelector(SELECTORS.context.title)?.textContent.trim();
  if (title) context.title = title;
  const params = new URL(document.URL).searchParams;
  const courseId =
    /** @type {HTMLInputElement|null} */ (
      doc.querySelector(SELECTORS.context.courseId)
    )?.value ||
    params.get("courseId") ||
    params.get("courseid");
  if (courseId && invoke) {
    const metadata = await invoke("query_course_meta", { courseId });
    const course = metadata?.title.trim();
    if (course) context.course = course;
  }
  return context;
};

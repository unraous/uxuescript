/**
 * @typedef {typeof import("../../src/services/cmds").commands} Commands
 * @typedef {(command: "options") => ReturnType<Commands["options"]>} OptionsInvoke
 * @typedef {(command: "solve_questions", args: {payload: Parameters<Commands["solveQuestions"]>[0]}) => ReturnType<Commands["solveQuestions"]>} SolveInvoke
 * @typedef {(command: "confirm", args: {message: string}) => Promise<boolean>} ConfirmInvoke
 * @typedef {(command: "send_status", args: {status: Parameters<Commands["sendStatus"]>[0]}) => ReturnType<Commands["sendStatus"]>} StatusInvoke
 * @typedef {(command: "insert_course_meta_map", args: {courseId: string, metadata: Parameters<Commands["insertCourseMetaMap"]>[1]}) => Promise<void>} MetadataInvoke
 * @typedef {(command: "query_course_meta", args: {courseId: string}) => ReturnType<Commands["queryCourseMeta"]>} QueryMetadataInvoke
 * @typedef {(command: "plugin:log|log", args: {level: number, message: string, location?: string}) => Promise<void>} LogInvoke
 * @typedef {OptionsInvoke & SolveInvoke & ConfirmInvoke & StatusInvoke & MetadataInvoke & QueryMetadataInvoke & LogInvoke} InjectedInvoke
 */

/** 当前 WebView 的 IPC 入口；普通浏览器中为 undefined。 */
export const invoke =
  /** @type {Window & {__TAURI_INTERNALS__?: {invoke: InjectedInvoke}}} */ (
    window
  ).__TAURI_INTERNALS__?.invoke;

/**
 * 使用 Tauri 确认框，普通浏览器则使用原生确认框。
 * @param {string} message 提示内容。
 * @returns {boolean|Promise<boolean>}
 */
export const confirm = (message) =>
  invoke ? invoke("confirm", { message }) : window.confirm(message);

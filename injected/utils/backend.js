/**
 * @typedef {typeof import("../../src/services/cmds").commands} Commands
 * @typedef {(command: "options") => ReturnType<Commands["options"]>} OptionsInvoke
 * @typedef {(command: "solve_questions", args: {payload: Parameters<Commands["solveQuestions"]>[0]}) => ReturnType<Commands["solveQuestions"]>} SolveInvoke
 * @typedef {(command: "confirm", args: {message: string, options?: Partial<import("../../src/services/cmds").ConfirmOptions> | null}) => Promise<boolean>} ConfirmInvoke
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
 * @param {Partial<import("../../src/services/cmds").ConfirmOptions>} [options] 标题及允许确认前的阅读时间（秒）。浏览器原生确认框不支持这些选项。
 * @returns {boolean|Promise<boolean>}
 */
export const confirm = (message, options) =>
  invoke
    ? invoke("confirm", options ? { message, options } : { message })
    : window.confirm(message);

import { wait, assert } from "@injected/utils/async.js";

/**
 * 等待页面已有的 UEditor 就绪，聚焦后写入内容；考试预览逐空暂存。
 * @param {HTMLTextAreaElement} textarea 编辑器对应的 textarea。
 * @param {string} content 要填写的内容。
 * @param {{container: string, button: string} | null} [save] 页面提供的暂存按钮定位规则。
 * @returns {Promise<void>}
 */
export async function fillEditor(textarea, content, save) {
  const page =
    /** @type {Window & {submitOnce?: boolean, UE?: {getEditor(id: string): {isReady: boolean, body: HTMLElement, focus(): void, setContent(content: string): void} | undefined}}} */ (
      textarea.ownerDocument.defaultView
    );
  const editor = await wait.until(() => {
    const instance = page.UE?.getEditor(textarea.id);
    return instance?.isReady ? instance : null;
  });
  assert(editor, `UEditor 编辑器未就绪: ${textarea.id}`);
  const button = save
    ? /** @type {HTMLElement|null} */ (
        textarea.closest(save.container)?.querySelector(save.button) ?? null
      )
    : null;
  if (save) {
    assert(button, `未找到编辑器保存按钮: ${textarea.id}`);
  }
  editor.focus();
  if (button) {
    // 预览页监听的是编辑器 body 的 DOM 焦点，而非 UEditor 自身的 focus 事件。
    editor.body.focus();
    assert(
      await wait.until(() => page.getComputedStyle(button).display !== "none"),
      `等待编辑器保存按钮显示超时: ${textarea.id}`,
    );
  }
  editor.setContent(content);
  if (button) {
    // 平台在另一个暂存请求进行时会直接忽略新的保存操作。
    assert(
      await wait.until(() => !page.submitOnce, 15000),
      `等待其他答案暂存完成超时: ${textarea.id}`,
    );
    button.click();
    assert(
      await wait.until(
        () =>
          page.getComputedStyle(button).display === "none" && !page.submitOnce,
        15000,
      ),
      `答案暂存超时: ${textarea.id}`,
    );
  }
}

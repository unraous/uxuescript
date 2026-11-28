import { preserveFocusState } from "./focus.js";

/**
 * 请求顶层页面导航；跨域直接导航失败时沿用消息转发路径。
 * @param {string} url 目标地址。
 * @returns {void}
 */
const safeNavigate = (url) => {
  if (url.startsWith("javascript:")) return;
  if (window === window.top) {
    window.location.href = url;
    return;
  }
  // 跨域 frame 直接改 top.location 会被浏览器静默拦下，这里的读取会抛错，
  // 因而跨域时改走消息转发，由顶层页面完成导航。
  try {
    if (window.top.location.href) {
      window.top.location.href = url;
      return;
    }
  } catch {
    window.top.postMessage({ __uxue_navigate: url }, "*");
  }
};

/**
 * 在顶层窗口接收原框架导航消息。
 * @param {MessageEvent} event 消息事件。
 * @returns {void}
 */
const handleNavigationMessage = (event) => {
  if (event.data?.__uxue_navigate)
    window.location.href = event.data.__uxue_navigate;
};

/**
 * 判断锚点是否要求打开到新窗口或顶层窗口。
 * @param {HTMLAnchorElement} link 锚点元素。
 * @returns {boolean}
 */
const opensInTop = (link) => {
  const target = link.getAttribute("target") || link.target;
  return target === "_blank" || target === "_top" || target === "_parent";
};

/**
 * 将打开新窗口、父窗口或顶层窗口的链接转交给顶层导航。
 * @param {MouseEvent} e 点击事件。
 * @returns {void}
 */
const handleLinkClick = (e) => {
  const eventTarget = e.target;
  if (!(eventTarget instanceof Element)) return;

  const link = eventTarget.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return;

  const href = link.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

  if (opensInTop(link)) {
    e.preventDefault();
    e.stopPropagation();
    safeNavigate(link.href);
  }
};

/**
 * 接管尚未插入文档的锚点。部分平台（如继续教育平台）通过
 * `a.dispatchEvent(new MouseEvent("click"))` 打开学习页，这类事件不经过
 * document，只能在派发入口拦截，否则点击会被静默丢弃。
 * @param {HTMLAnchorElement} link 锚点元素。
 * @returns {void}
 */
const navigateDetachedLink = (link) => {
  const href = link.getAttribute("href");
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
  if (!opensInTop(link)) return;
  safeNavigate(link.href);
};

/**
 * 拦截动态锚点的 click 调用与事件派发。
 * @returns {void}
 */
const installDetachedLinkBridge = () => {
  const anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.isConnected) navigateDetachedLink(this);
    return anchorClick.apply(this, arguments);
  };

  const dispatchEvent = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (/** @type {Event} */ event) {
    if (
      event?.type === "click" &&
      this instanceof HTMLAnchorElement &&
      !this.isConnected
    )
      navigateDetachedLink(this);
    return dispatchEvent.call(this, event);
  };
};

/**
 * 安装框架页面适配和顶层导航转发，并应用焦点适配。
 * @returns {void}
 */
export function main() {
  preserveFocusState();
  if (window === window.top)
    window.addEventListener("message", handleNavigationMessage);
  window.open = function (url) {
    if (url && typeof url === "string") {
      safeNavigate(url);
    }
    return window;
  };

  document.addEventListener("click", handleLinkClick, true);
  installDetachedLinkBridge();
}

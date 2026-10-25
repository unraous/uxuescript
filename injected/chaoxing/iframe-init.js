/**
 * 请求顶层页面导航；跨域直接导航失败时沿用消息转发路径。
 * @param {string} url 目标地址。
 * @returns {void}
 */
const safeNavigate = (url) => {
  if (!url || url.startsWith("javascript:")) return;
  try {
    window.top.location.href = url;
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

  const target = link.getAttribute("target") || link.target;
  if (target === "_blank" || target === "_top" || target === "_parent") {
    e.preventDefault();
    e.stopPropagation();
    safeNavigate(link.href);
  }
};

/**
 * 安装顶层导航转发；不修改焦点、可见性或平台事件监听。
 * @returns {void}
 */
export function main() {
  if (window === window.top)
    window.addEventListener("message", handleNavigationMessage);
  window.open = function (url) {
    if (url && typeof url === "string") {
      safeNavigate(url);
    }
    return window;
  };

  document.addEventListener("click", handleLinkClick, true);
}

import { invoke } from "@injected/utils/backend.js";
/** Tauri 日志插件的等级值，与原 console 方法对应。 */
const levels = {
  log: 3,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
};

const MAX_DEPTH = 4;
const MAX_ITEMS = 50;
const MAX_TEXT_LENGTH = 2000;
const MAX_MESSAGE_LENGTH = 8000;

/**
 * 超长文本保留前缀并追加省略号。
 * @param {string} value 日志文本。
 * @param {number} [limit=MAX_TEXT_LENGTH] 最大保留长度。
 * @returns {string}
 */
const truncate = (value, limit = MAX_TEXT_LENGTH) =>
  value.length > limit ? `${value.slice(0, limit)}…` : value;

/**
 * 将 DOM 节点压缩为标签、ID、类名或文本摘要。
 * @param {{nodeType: number, nodeName: string, tagName?: string, id?: string, className?: unknown, textContent?: string}} value 具有 nodeType 和 nodeName 的节点对象。
 * @returns {string}
 */
const describeNode = (value) => {
  if (value.nodeType === 1) {
    const tag = value.tagName?.toLowerCase() || "element";
    const id = value.id ? `#${value.id}` : "";
    const className =
      typeof value.className === "string"
        ? value.className
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 3)
            .map((name) => `.${name}`)
            .join("")
        : "";
    return `<${tag}${id}${className}>`;
  }

  if (value.nodeType === 3) {
    return `#text(${truncate(String(value.textContent || "").trim())})`;
  }

  return `<${String(value.nodeName || "node").toLowerCase()}>`;
};

/**
 * 序列化单个日志参数，沿用原有循环引用、深度和条目数量限制。
 * @param {unknown} value 任意 console 参数。
 * @param {WeakSet<object>} [seen] 当前参数已访问的对象。
 * @param {number} [depth=0] 当前嵌套深度。
 * @returns {string}
 */
const stringify = (value, seen = new WeakSet(), depth = 0) => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function")
    return `[Function ${value.name || "anonymous"}]`;
  if (value instanceof Error) return value.stack || value.message;
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    if (
      "nodeType" in value &&
      typeof value.nodeType === "number" &&
      "nodeName" in value &&
      typeof value.nodeName === "string"
    ) {
      return describeNode(
        /** @type {Parameters<typeof describeNode>[0]} */ (value),
      );
    }

    if (seen.has(value)) return "[Circular]";
    if (depth >= MAX_DEPTH) return `[${Object.prototype.toString.call(value)}]`;

    seen.add(value);

    if (Array.isArray(value)) {
      const items = /** @type {unknown[]} */ (value)
        .slice(0, MAX_ITEMS)
        .map((item) => stringify(item, seen, depth + 1));
      if (value.length > MAX_ITEMS)
        items.push(`… +${value.length - MAX_ITEMS} items`);
      return `[${items.join(", ")}]`;
    }

    const keys = Object.keys(value).slice(0, MAX_ITEMS);
    if (keys.length === 0) return Object.prototype.toString.call(value);

    const record = /** @type {Record<string, unknown>} */ (value);
    const entries = keys.map(
      (key) => `${key}: ${stringify(record[key], seen, depth + 1)}`,
    );
    if (Object.keys(value).length > MAX_ITEMS) entries.push("…");
    return `{ ${entries.join(", ")} }`;
  }

  return String(value);
};

/**
 * 安装指定 console 方法的代理，保留原输出并转发到已就绪的 Tauri IPC。
 * @param {"log"|"debug"|"info"|"warn"|"error"} fnName 方法名。
 * @returns {void}
 */
const forwardConsole = (fnName) => {
  const original = console[fnName];
  console[fnName] = /** @param {unknown[]} args */ (...args) => {
    original.apply(console, args);

    const message = truncate(
      args.map((value) => stringify(value)).join(" "),
      MAX_MESSAGE_LENGTH,
    );
    void invoke("plugin:log|log", {
      level: levels[fnName],
      message: `[webview:chaoxing] ${message}`,
    }).catch(() => {});
  };
};

/**
 * 将页面 console 调用转发到桌面端。
 * @returns {void}
 */
export function main() {
  forwardConsole("log");
  forwardConsole("debug");
  forwardConsole("info");
  forwardConsole("warn");
  forwardConsole("error");
}

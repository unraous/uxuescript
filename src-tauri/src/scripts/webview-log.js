(() => {
  const invoke = globalThis.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== "function") return;

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

  const truncate = (value, limit = MAX_TEXT_LENGTH) =>
    value.length > limit ? `${value.slice(0, limit)}…` : value;

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

  const stringify = (value, seen = new WeakSet(), depth = 0) => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return value;
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "symbol") return value.toString();
    if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
    if (value instanceof Error) return value.stack || value.message;
    if (value instanceof Date) return value.toISOString();

    if (typeof value === "object") {
      if (typeof value.nodeType === "number" && typeof value.nodeName === "string") {
        return describeNode(value);
      }

      if (seen.has(value)) return "[Circular]";
      if (depth >= MAX_DEPTH) return `[${Object.prototype.toString.call(value)}]`;

      seen.add(value);

      if (Array.isArray(value)) {
        const items = value
          .slice(0, MAX_ITEMS)
          .map((item) => stringify(item, seen, depth + 1));
        if (value.length > MAX_ITEMS) items.push(`… +${value.length - MAX_ITEMS} items`);
        return `[${items.join(", ")}]`;
      }

      const keys = Object.keys(value).slice(0, MAX_ITEMS);
      if (keys.length === 0) return Object.prototype.toString.call(value);

      const entries = keys.map(
        (key) => `${key}: ${stringify(value[key], seen, depth + 1)}`,
      );
      if (Object.keys(value).length > MAX_ITEMS) entries.push("…");
      return `{ ${entries.join(", ")} }`;
    }

    return String(value);
  };

  const forwardConsole = (fnName) => {
    const original = console[fnName];
    if (typeof original !== "function") return;

    console[fnName] = (...args) => {
      original.apply(console, args);

      const message = truncate(args.map((value) => stringify(value)).join(" "), MAX_MESSAGE_LENGTH);
      void invoke("plugin:log|log", {
        level: levels[fnName],
        message: `[webview:chaoxing] ${message}`,
      }).catch(() => {});
    };
  };

  forwardConsole("log");
  forwardConsole("debug");
  forwardConsole("info");
  forwardConsole("warn");
  forwardConsole("error");
})();

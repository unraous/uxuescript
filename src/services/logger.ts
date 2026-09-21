import { debug, error, info, trace, warn } from "@tauri-apps/plugin-log";

type Logger = (message: string) => Promise<void>;
type ConsoleMethod = "log" | "debug" | "info" | "warn" | "error";

const stringify = (value: unknown): string => {
	if (typeof value === "string") return value;
	if (value instanceof Error) return value.stack ?? value.message;

	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

const forwardConsole = (method: ConsoleMethod, logger: Logger, label: string) => {
	const original = console[method].bind(console);

	console[method] = (...args: unknown[]) => {
		original(...args);
		void logger(`[webview:${label}] ${args.map(stringify).join(" ")}`).catch(() => {});
	};
};

export const installConsoleLogger = (label: string) => {
	forwardConsole("log", trace, label);
	forwardConsole("debug", debug, label);
	forwardConsole("info", info, label);
	forwardConsole("warn", warn, label);
	forwardConsole("error", error, label);
};

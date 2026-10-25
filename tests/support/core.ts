import { runInNewContext } from "node:vm";
import { vi } from "vitest";
import script from "../../src-tauri/src/scripts/core.js?raw";

type TaskType = "Video" | "Audio" | "PDF" | "Quiz" | "Other";
type PreAction = (() => void | Promise<void>) | null;
type TaskHandler = (taskDoc: Document) => Promise<void>;

interface Overrides {
  handleVideo: TaskHandler;
  handleAudio: TaskHandler;
  handlePDF: TaskHandler;
  handleQuiz: TaskHandler;
  handleCourse(chapters: HTMLElement[]): Promise<void>;
  blockingCount(chapters: HTMLElement[]): number;
  totalChapterList(): HTMLElement[];
}

interface Context {
  window?: {
    confirm?: (message?: string) => boolean | Promise<boolean>;
    setTimeout?: Window["setTimeout"];
    __TAURI_INTERNALS__?: {
      invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
    };
  };
  document?: Document;
  console?: Pick<Console, "info" | "error">;
  Math?: Pick<Math, "random" | "floor">;
  URL?: typeof URL;
  fetch?: typeof fetch;
}

// The standalone script intentionally exports no module API; describe its test boundary here.
interface CoreApi {
  config: {
    debugTaskTypes: TaskType[];
    hasBackend: boolean;
    switchingCd: number | null;
    muteVideo: boolean;
    lockSpeed: number | null;
    quizReview: boolean;
    loadFromBackend(): Promise<void>;
  };
  wait: {
    elements(
      action: PreAction,
      selector: string,
      root: ParentNode,
      errorMsg?: string | false,
    ): Promise<HTMLElement[]>;
    element(
      action: PreAction,
      selector: string,
      root: ParentNode,
      errorMsg?: string | false,
    ): Promise<HTMLElement>;
    until<T>(
      getter: () => T,
      timeout?: number,
      interval?: number,
    ): Promise<T | null>;
    taskPointComplete(root: HTMLElement): Promise<boolean>;
    iframeDoc(
      action: PreAction,
      selector: string,
      root: ParentNode,
      errorMsg?: string | false,
    ): Promise<Document>;
  };
  handleTab(chapter: Document): Promise<void>;
  handleQuiz: TaskHandler;
  handleAudio: TaskHandler;
  resolveQuizPolicy(
    taskDoc: Document,
    label: string,
  ): Promise<{
    kind: string;
    allowFill: boolean;
    allowSubmit: boolean;
    reason: string;
  }>;
  sleep(ms: number, fluctuationPercent?: number): Promise<void>;
  switchingCooldown(): Promise<void>;
  resolveInteractiveQuizAnswer(
    url: string,
    quiz: { questionType?: string; options?: { name?: string }[] },
    origin: string,
  ): Promise<string>;
  controller: {
    state: string;
    setMedia(media: { pause?(): void; play?(): void } | null): void;
    pause(): void;
    resume(): void;
    stop(): void;
    checkpoint(): Promise<void>;
  };
  main(): Promise<void>;
}

export function loadCore(
  context: Context,
  overrides: Partial<Overrides> = {},
): CoreApi {
  let source = script;
  const assignments: string[] = [];
  for (const name of Object.keys(overrides)) {
    const declaration = `const ${name} =`;
    if (!source.includes(declaration))
      throw new Error(`Missing core declaration: ${name}`);
    source = source.replace(declaration, `let ${name} =`);
    assignments.push(`${name} = globalThis.overrides.${name};`);
  }
  const entry = "  main();";
  if (!source.includes(entry)) throw new Error("Missing core entry point");
  source = source.replace(
    entry,
    `
    ${assignments.join("\n")}
    return { config, wait, handleTab, handleQuiz, handleAudio, resolveQuizPolicy, controller, sleep, switchingCooldown, resolveInteractiveQuizAnswer, main };
  `,
  );
  const sandbox = {
    console: { info: vi.fn(), error: vi.fn() },
    performance,
    ...context,
    window: {
      confirm: window.confirm.bind(window),
      setTimeout: window.setTimeout.bind(window),
      ...context.window,
    },
    overrides,
  };
  // node:vm cannot infer the value returned by evaluated JavaScript.
  return runInNewContext(source, sandbox) as CoreApi;
}

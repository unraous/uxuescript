import { describe, expect, it, vi } from "vitest";
import { loadCore } from "../support/core";

function setup(options: Record<string, unknown>, confirmAnswers: boolean[]) {
  const confirmCalls: string[] = [];
  const queue = confirmAnswers.slice();
  const invoke = vi.fn(
    async (command: string, args?: Record<string, unknown>) => {
      if (command === "options") return options;
      if (command === "confirm") {
        confirmCalls.push(String(args?.message ?? ""));
        return queue.shift() ?? false;
      }
      if (command === "send_status") return null;
      return null;
    },
  );
  const api = loadCore({
    window: { __TAURI_INTERNALS__: { invoke }, setTimeout },
    document,
  });
  return { api, confirmCalls };
}

describe("task-level answer policy", () => {
  it("defaults review on when the backend omits quizReview", async () => {
    const { api } = setup({}, []);
    await api.config.loadFromBackend();
    expect(api.config.quizReview).toBe(true);
  });

  it("defaults review on when options IPC fails", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "options") throw new Error("ipc failure");
      return null;
    });
    const api = loadCore({
      window: { __TAURI_INTERNALS__: { invoke }, setTimeout },
      document,
    });
    await api.config.loadFromBackend();
    expect(api.config.quizReview).toBe(true);
  });

  it("denies a page with a graded/exam signal without prompting", async () => {
    const { api, confirmCalls } = setup({ quizReview: true }, []);
    const policy = await api.resolveQuizPolicy(
      { body: { innerText: "期末考试" } } as Document,
      "chapter quiz",
    );
    expect(policy).toMatchObject({
      kind: "GRADED",
      allowFill: false,
      allowSubmit: false,
    });
    expect(confirmCalls).toHaveLength(0);
  });

  it("requires separate fill and submit confirmations", async () => {
    const { api, confirmCalls } = setup({ quizReview: true }, [true, false]);
    const policy = await api.resolveQuizPolicy(
      { body: { innerText: "章节测验" } } as Document,
      "chapter quiz",
    );
    expect(policy).toMatchObject({
      kind: "UNGRADED",
      allowFill: true,
      allowSubmit: false,
    });
    expect(confirmCalls).toHaveLength(2);
  });

  it("does not automate when fill authorization is refused", async () => {
    const { api, confirmCalls } = setup({ quizReview: true }, [false]);
    const policy = await api.resolveQuizPolicy(
      { body: { innerText: "章节测验" } } as Document,
      "chapter quiz",
    );
    expect(policy).toMatchObject({
      kind: "NEEDS_CONFIRMATION",
      allowFill: false,
      allowSubmit: false,
    });
    expect(confirmCalls).toHaveLength(1);
  });
});

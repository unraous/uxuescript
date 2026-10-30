import { afterEach, describe, expect, it, vi } from "vitest";
import { sleep } from "@injected/utils/async.js";
import { resolveInteractiveQuizAnswer } from "@injected/chaoxing/course/chapter/tasks/interactive.js";
import { config, cooldown } from "@injected/chaoxing/runtime.js";
/** @param {number | null} cd */
function setup(cd = null, random = 0.5) {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(Math, "random").mockReturnValue(random);
  const setTimeout = vi.spyOn(window, "setTimeout");
  config.switchingCd = cd;
  return {
    sleep,
    cooldown,
    resolveInteractiveQuizAnswer,
    fetch,
    setTimeout,
  };
}
const quiz = { options: [{ name: "A" }, { name: "B" }, { name: "C" }] };
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("course cooldown", () => {
  it("defaults to a one-second delay in standalone mode", async () => {
    vi.resetModules();
    vi.stubGlobal("__TAURI_INTERNALS__", undefined);
    const runtime = await import("@injected/chaoxing/runtime.js");
    expect(runtime.config.switchingCd).toBe(1);
  });

  it("does not schedule a timer when disabled", async () => {
    const api = setup();
    await api.cooldown();
    expect(api.setTimeout).not.toHaveBeenCalled();
  });
  it.each([
    [0, 1500],
    [0.5, 2000],
    [1, 2500],
  ])("random value %s waits %s milliseconds", async (random, expected) => {
    vi.useFakeTimers();
    const api = setup(2, random);
    const waiting = api.cooldown();
    expect(api.setTimeout).toHaveBeenCalledWith(expect.any(Function), expected);
    await vi.runAllTimersAsync();
    await waiting;
    const fixed = api.sleep(750);
    expect(api.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 750);
    await vi.runAllTimersAsync();
    await fixed;
  });
  it.each([null, 2])(
    "validates serially and stops at the first match (CD %s)",
    async (cd) => {
      vi.useFakeTimers();
      const api = setup(cd);
      /** @type {(response: Response) => void} */
      let respond;
      api.fetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          }),
      );
      api.fetch.mockImplementation(async () =>
        Response.json({ isRight: true }),
      );
      const answer = api.resolveInteractiveQuizAnswer(
        "/validate",
        quiz,
        "https://example.com",
      );
      await vi.runAllTimersAsync();
      expect(api.fetch).toHaveBeenCalledTimes(1);
      respond(Response.json({ isRight: false }));
      await vi.runAllTimersAsync();
      await expect(answer).resolves.toBe("C");
      expect(api.fetch).toHaveBeenCalledTimes(2);
      expect(api.setTimeout).toHaveBeenCalledTimes(cd === null ? 0 : 2);
    },
  );
  it("reports failure after exhausting candidates", async () => {
    const api = setup();
    api.fetch.mockImplementation(async () => Response.json({ isRight: false }));
    await expect(
      api.resolveInteractiveQuizAnswer(
        "/validate",
        quiz,
        "https://example.com",
      ),
    ).rejects.toThrow("互动题验证未返回正确答案（候选数：3）");
    expect(api.fetch).toHaveBeenCalledTimes(3);
  });
  it("shuffles validation order while retaining every multiple-choice candidate", async () => {
    const api = setup(null, 0);
    const data = { ...quiz, questionType: "多选题" };
    const original = JSON.stringify(data);
    api.fetch.mockImplementation(async () => Response.json({ isRight: false }));
    await expect(
      api.resolveInteractiveQuizAnswer(
        "/validate",
        data,
        "https://example.com",
      ),
    ).rejects.toThrow("候选数：7");
    const order = api.fetch.mock.calls.map(([url]) =>
      new URL(String(url)).searchParams.get("answerContent"),
    );
    const candidates = ["A", "B", "A,B", "C", "A,C", "B,C", "A,B,C"];
    expect(order).not.toEqual(candidates);
    expect([...order].sort()).toEqual([...candidates].sort());
    expect(JSON.stringify(data)).toBe(original);
  });
  it("stops on a failed request", async () => {
    const api = setup();
    api.fetch.mockResolvedValue(new Response(null, { status: 500 }));
    await expect(
      api.resolveInteractiveQuizAnswer(
        "/validate",
        quiz,
        "https://example.com",
      ),
    ).rejects.toThrow("HTTP 500");
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });
});

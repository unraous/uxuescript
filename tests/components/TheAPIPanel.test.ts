import type { showError } from "@/services/errors";
import type { commands } from "@/services/cmds";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TheAPIPanel from "@/components/TheConfigPanel/TheAPIPanel.vue";
import { label } from "@/labels";

const mocks = vi.hoisted(() => ({
  providers: vi.fn<typeof commands.providers>(),
  currentProvider: vi.fn<typeof commands.currentProvider>(),
  setKey: vi.fn<typeof commands.setKey>(),
  upsertProvider: vi.fn<typeof commands.upsertProvider>(),
  healthy: vi.fn<typeof commands.healthy>(),
  confirm: vi.fn<typeof commands.confirm>(),
  error: vi.fn<typeof showError>(),
}));
vi.mock("@/services/cmds", () => ({ commands: mocks }));
vi.mock("@/services/errors", () => ({ showError: mocks.error }));

beforeEach(() => {
  const providers = [
    {
      name: "Test Provider",
      isCustom: true,
      protocol: "OpenAIChatCompletions" as const,
      baseUrl: "https://example.com",
      apiKey: "saved-api-key",
      models: ["test-model"],
      chosenModel: 0,
    },
  ];
  mocks.providers.mockImplementation(async () => structuredClone(providers));
  mocks.currentProvider.mockResolvedValue("Test Provider");
  mocks.confirm.mockResolvedValue(true);
});

describe("API connection test", () => {
  it("calls healthy, disables repeat clicks and explains success", async () => {
    let resolve!: (value: string) => void;
    mocks.healthy.mockReturnValue(
      new Promise<string>((done) => {
        resolve = done;
      }),
    );
    const wrapper = mount(TheAPIPanel);
    await flushPromises();
    const button = wrapper.get<HTMLButtonElement>(
      `[aria-label="${label("testConnection")}"]`,
    );
    await button.trigger("click");
    expect(mocks.healthy).toHaveBeenCalledOnce();
    expect(button.element.disabled).toBe(true);
    expect(button.attributes("aria-label")).toBe("Testing...");
    await button.trigger("click");
    expect(mocks.healthy).toHaveBeenCalledOnce();
    resolve("ok");
    await flushPromises();
    expect(mocks.confirm).toHaveBeenCalledWith(
      "Connection successful.\nThe model answered the test question.",
      null,
    );
    expect(button.element.disabled).toBe(false);
    expect(button.attributes("aria-label")).toBe(label("testConnection"));
    wrapper.unmount();
  });

  it("shows the exact upstream error and allows another test", async () => {
    mocks.healthy.mockRejectedValue("API 错误 (401): invalid_api_key");
    const wrapper = mount(TheAPIPanel);
    await flushPromises();
    const button = wrapper.get<HTMLButtonElement>(
      `[aria-label="${label("testConnection")}"]`,
    );
    await button.trigger("click");
    await flushPromises();
    expect(mocks.error).toHaveBeenCalledWith(
      "Connection failed:",
      "API 错误 (401): invalid_api_key",
    );
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(button.element.disabled).toBe(false);
    wrapper.unmount();
  });

  it("restores rejected API inputs and keeps the key masked on blur", async () => {
    mocks.setKey.mockRejectedValueOnce(new Error("invalid key"));
    mocks.upsertProvider.mockRejectedValueOnce(new Error("failed"));
    const wrapper = mount(TheAPIPanel);
    await flushPromises();
    const endpoint = wrapper.get<HTMLInputElement>(
      'input[placeholder="https://api.example.com/v1/chat/completions"]',
    );
    await endpoint.setValue("broken");
    await flushPromises();
    expect(endpoint.element.value).toBe("https://example.com");
    const key = wrapper.get<HTMLInputElement>(
      'input[placeholder="Enter API key"]',
    );
    await key.trigger("focus");
    await key.setValue("bad");
    await flushPromises();
    expect(key.element.value).toBe("saved-api-key");
    await key.trigger("blur");
    expect(key.element.value).toBe("*".repeat("saved-api-key".length));
    expect(mocks.error).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});

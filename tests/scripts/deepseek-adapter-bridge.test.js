import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Script, createContext, runInContext } from "node:vm";
import { expect, it } from "vitest";

/** @typedef {import("../../injected/deepseek-web/bootstrap.js").AdapterApi} AdapterApi */

const bundles = [
  resolve("dist/scripts/embedded/deepseek-web-adapter.js"),
];
const apiKeys = /** @type {const} */ ([
  "VERSION",
  "createDeepSeekAdapter",
  "getDeepSeekAdapterInstance",
]);
const instanceSlot = 'Symbol.for("deepseek-web-adapter.instance.v1")';

it("builds the adapter from embedded source without a local package dependency", () => {
  const entry = readFileSync("injected/deepseek-web/adapter.js", "utf8");
  expect(entry).toMatch(
    /^import \* as api from ["']\.\/adapter-core\/index\.js["'];/m,
  );
  expect(existsSync("injected/deepseek-web/adapter-core/index.js")).toBe(true);
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  expect(packageJson.devDependencies).not.toHaveProperty(
    "deepseek-web-adapter",
  );
  expect(readFileSync("pnpm-lock.yaml", "utf8")).not.toMatch(
    /^\s+deepseek-web-adapter:/m,
  );
});

it("delivers a synchronous, lazy script with the existing mutable public API", () => {
  for (const path of bundles) {
    expect(
      existsSync(path),
      "build:scripts must generate the adapter bundle",
    ).toBe(true);
    const source = readFileSync(path, "utf8");
    expect(source).not.toMatch(
      /\bimport\s*(?:\(|["'{*])|\bexport\s|\beval\s*\(/,
    );
    const script = new Script(source);
    const context =
      /** @type {import("node:vm").Context & {DeepSeekWebAdapter?: AdapterApi}} */ (
        createContext({})
      );
    script.runInContext(context);
    const api = context.DeepSeekWebAdapter;

    expect(runInContext("typeof window", context)).toBe("undefined");
    expect(runInContext("typeof document", context)).toBe("undefined");
    expect(runInContext("typeof fetch", context)).toBe("undefined");
    expect(Object.keys(api).sort()).toEqual([...apiKeys].sort());
    expect(api.VERSION).toBe("0.1.0");
    expect(typeof api.createDeepSeekAdapter).toBe("function");
    expect(typeof api.getDeepSeekAdapterInstance).toBe("function");
    expect(api.getDeepSeekAdapterInstance()).toBeNull();
    expect(
      runInContext(`Reflect.has(globalThis, ${instanceSlot})`, context),
    ).toBe(false);
    expect(Object.getPrototypeOf(api)).toBe(
      runInContext("Object.prototype", context),
    );
    expect(Object.isExtensible(api)).toBe(true);
    for (const key of apiKeys) {
      expect(Object.getOwnPropertyDescriptor(api, key)).toEqual({
        value: api[key],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    expect(
      Object.getOwnPropertyDescriptor(context, "DeepSeekWebAdapter"),
    ).toEqual({
      value: api,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    api.VERSION = "consumer-probe";
    expect(api.VERSION).toBe("consumer-probe");
    expect(Reflect.set(api, "consumerProbe", true)).toBe(true);
    expect(Reflect.get(api, "consumerProbe")).toBe(true);
    expect(Reflect.deleteProperty(api, "consumerProbe")).toBe(true);
  }
});

it("preserves the page singleton across repeated script execution and releases it on dispose", async () => {
  for (const path of bundles) {
    const script = new Script(readFileSync(path, "utf8"));
    const context =
      /** @type {import("node:vm").Context & {DeepSeekWebAdapter?: AdapterApi}} */ (
        createContext({})
      );
    script.runInContext(context);
    const firstApi = context.DeepSeekWebAdapter;
    const instance = firstApi.createDeepSeekAdapter();
    try {
      expect(instance.getSession()).toBeNull();
      expect(firstApi.getDeepSeekAdapterInstance()).toBe(instance);
      expect(runInContext(`globalThis[${instanceSlot}]`, context)).toBe(
        instance,
      );
      expect(() => firstApi.createDeepSeekAdapter()).toThrowError(
        expect.objectContaining({ code: "INSTANCE_EXISTS" }),
      );

      script.runInContext(context);
      const nextApi = context.DeepSeekWebAdapter;
      expect(nextApi).not.toBe(firstApi);
      expect(nextApi.getDeepSeekAdapterInstance()).toBe(instance);
      expect(runInContext(`globalThis[${instanceSlot}]`, context)).toBe(
        instance,
      );
      expect(() => nextApi.createDeepSeekAdapter()).toThrowError(
        expect.objectContaining({ code: "INSTANCE_EXISTS" }),
      );
    } finally {
      await instance.dispose();
    }
    expect(firstApi.getDeepSeekAdapterInstance()).toBeNull();
    expect(context.DeepSeekWebAdapter.getDeepSeekAdapterInstance()).toBeNull();
    expect(
      runInContext(`Reflect.has(globalThis, ${instanceSlot})`, context),
    ).toBe(false);
    const replacement = context.DeepSeekWebAdapter.createDeepSeekAdapter();
    try {
      expect(replacement).not.toBe(instance);
      expect(firstApi.getDeepSeekAdapterInstance()).toBe(replacement);
    } finally {
      await replacement.dispose();
    }
    expect(context.DeepSeekWebAdapter.getDeepSeekAdapterInstance()).toBeNull();
  }
});

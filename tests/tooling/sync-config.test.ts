// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import build from "../../config/build.json";

let output: string;
const read = (path: string) => readFileSync(join(output, path), "utf8");

beforeAll(() => {
  mkdirSync(resolve("target"), { recursive: true });
  output = mkdtempSync(resolve("target/sync-config-test-"));
  for (const source of [
    "config",
    "scripts",
    "package.json",
    "src-tauri/Cargo.toml",
    "src-tauri/crates/uxs_commands",
    "src-tauri/src/lib.rs",
    "src-tauri/src/main.rs",
    "src-tauri/src/bin/sync-bindings.rs",
    "src-tauri/tauri.conf.json",
    "src-tauri/windows/fragments/updater-marker.wxs",
    "injected/chaoxing/course.js",
    "tests/updater/build.mjs",
    "Cargo.lock",
  ]) {
    const destination = join(output, source);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(source), destination, { recursive: true });
  }
  // Keep the copied package independent of the repository workspace.
  writeFileSync(
    join(output, "Cargo.toml"),
    '[workspace]\nmembers = ["src-tauri"]\nresolver = "2"\n',
  );
  const result = spawnSync(
    process.execPath,
    [join(output, "scripts/sync-config.mjs")],
    { encoding: "utf8", env: { ...process.env, UXS_BUILD_VERSION: "7.8.9" } },
  );
  expect(result.status, result.stderr).toBe(0);
});

afterAll(() => rmSync(output, { recursive: true, force: true }));

it("synchronizes one version into Cargo, package and Tauri", () => {
  expect(read("src-tauri/Cargo.toml")).toContain('version = "7.8.9"');
  expect(JSON.parse(read("package.json")).version).toBe("7.8.9");
  expect(JSON.parse(read("src-tauri/tauri.conf.json")).version).toBe("7.8.9");
  expect(JSON.parse(read("src-tauri/tauri.conf.json"))).toMatchObject({
    bundle: { publisher: build.app.author },
    plugins: {
      uxuescript: {
        msi: {
          valueName: build.msi.value_name,
          value: build.msi.value,
          keys: {
            [build.app.identifier]: build.msi.default.key,
            [build.app.mock_identifier]: build.msi.mock.key,
          },
        },
      },
    },
  });
  expect(
    JSON.parse(read("src-tauri/tauri.conf.json")).plugins.uxuescript,
  ).not.toHaveProperty("homeUrl");
  const check = spawnSync(process.execPath, [
    "--check",
    join(output, "injected/chaoxing/course.js"),
  ]);
  expect(check.status).toBe(0);
});

it("synchronizes registry parameters into Tauri and the MSI fragment", () => {
  const registry = JSON.parse(read("src-tauri/tauri.conf.json")).plugins
    .uxuescript.msi;
  for (const profile of ["default", "mock"] as const) {
    const result = spawnSync(
      process.execPath,
      [join(output, "scripts/sync-config.mjs")],
      {
        encoding: "utf8",
        env: { ...process.env, UXS_MSI_PROFILE: profile },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const fragment = read("src-tauri/windows/fragments/updater-marker.wxs");
    const identifier =
      build.app.identifier + (profile === "mock" ? ".mock" : "");
    expect(registry.keys[identifier]).toBe(build.msi[profile].key);
    const xml = new DOMParser().parseFromString(fragment, "application/xml");
    expect(xml.querySelector("parsererror")).toBeNull();
    expect(xml.querySelector("RegistryKey")?.getAttribute("Key")).toBe(
      registry.keys[identifier],
    );
    expect(xml.querySelector("RegistryValue")?.getAttribute("Name")).toBe(
      registry.valueName,
    );
    expect(xml.querySelector("Component")?.getAttribute("Guid")).toBe(
      build.msi[profile].guid,
    );
    expect(xml.querySelector("Component")?.getAttribute("Id")).toBe(
      build.msi.component_id,
    );
    expect(xml.querySelector("RegistryValue")?.getAttribute("Value")).toBe(
      String(registry.value),
    );
  }
  spawnSync(process.execPath, [join(output, "scripts/sync-config.mjs")], {
    env: process.env,
  });
});

it("synchronizes mock source and server settings from the same configuration", () => {
  const result = spawnSync(
    process.execPath,
    [join(output, "scripts/sync-config.mjs")],
    { encoding: "utf8", env: { ...process.env, UXS_MSI_PROFILE: "mock" } },
  );
  expect(result.status, result.stderr).toBe(0);
  const mock = JSON.parse(read("src-tauri/tauri.conf.json"));
  expect(mock.plugins.updater.endpoints).toEqual([
    `http://127.0.0.1:${build.updater.mock.port}/latest.json`,
  ]);
  expect(mock.identifier).toBe(build.app.mock_identifier);
  expect(mock.bundle.targets).toEqual(["msi"]);
  expect(mock.plugins.uxuescript.msi.keys[mock.identifier]).toBe(
    build.msi.mock.key,
  );
  spawnSync(process.execPath, [join(output, "scripts/sync-config.mjs")], {
    env: process.env,
  });
});

it("restores synchronized files and Cargo.lock when MSI build fails", () => {
  const paths = [
    "package.json",
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json",
    "src-tauri/windows/fragments/updater-marker.wxs",
  ].map((path) => join(output, path));
  paths.push(join(output, "Cargo.lock"));
  const before = paths.map((path) => readFileSync(path));
  const failure = join(output, "fail-build.mjs");
  writeFileSync(
    failure,
    `
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const spawn = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) =>
  args[0].endsWith("tauri.js") ? { status: 1 } : spawn(command, args, options);
syncBuiltinESMExports();
`,
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(failure).href,
      join(output, "tests/updater/build.mjs"),
    ],
    {
      cwd: output,
      encoding: "utf8",
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: "unused-test-key" },
    },
  );
  expect(result.status, result.stderr).toBe(1);
  expect(result.stdout).toContain(
    "Syncing config, building, and signing 2.2.0",
  );
  expect(result.stdout).toContain("Restored original files and Cargo.lock");
  paths.forEach((path, index) =>
    expect(readFileSync(path)).toEqual(before[index]),
  );
});

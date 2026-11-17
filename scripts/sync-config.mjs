import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = /** @type {typeof import("../config/build.json")} */ (
  JSON.parse(read("config/build.json"))
);
const version = process.env.UXS_BUILD_VERSION ?? config.version;
const profile = process.env.UXS_MSI_PROFILE === "mock" ? "mock" : "default";
const identifier =
  profile === "mock" ? config.app.mock_identifier : config.app.identifier;
const msi = config.msi[profile];

/** @param {string} path */
function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}

/**
 * @param {string} path
 * @param {string} content
 */
function write(path, content) {
  const target = resolve(root, path);
  if (readFileSync(target, "utf8") !== content) writeFileSync(target, content);
}

/**
 * @param {string} source
 * @param {string} table
 * @param {string} key
 * @param {string | string[]} value
 */
function setTomlField(source, table, key, value) {
  const tableStart = source.indexOf(`[${table}]`);
  const nextTable = source.indexOf("\n[", tableStart + 1);
  const tableEnd = nextTable === -1 ? source.length : nextTable;
  const section = source.slice(tableStart, tableEnd);
  const field = new RegExp(`^${key}\\s*=.*$`, "m");
  if (!field.test(section))
    throw new Error(`Missing Cargo field [${table}].${key}`);
  return (
    source.slice(0, tableStart) +
    section.replace(field, `${key} = ${JSON.stringify(value)}`) +
    source.slice(tableEnd)
  );
}

// Update only [package] so Cargo comments and dependency edits remain untouched.
let cargo = read("src-tauri/Cargo.toml");
for (const [key, value] of Object.entries({
  name: config.app.name,
  "default-run": config.app.name,
  version,
  authors: [config.app.author],
})) {
  cargo = setTomlField(cargo, "package", key, value);
}
write("src-tauri/Cargo.toml", cargo);
const manifest = spawnSync(
  "cargo",
  ["read-manifest", "--manifest-path", resolve(root, "src-tauri/Cargo.toml")],
  { encoding: "utf8", cwd: root },
);
if (manifest.status !== 0)
  throw new Error(manifest.stderr || "Cargo rejected src-tauri/Cargo.toml");
const cargoPackage = /** @type {{name: string, version: string}} */ (
  JSON.parse(manifest.stdout)
);
if (cargoPackage.version !== version || cargoPackage.name !== config.app.name)
  throw new Error(
    "Cargo parsed package metadata does not match config/build.json",
  );

const packageJson = /** @type {typeof import("../package.json")} */ (
  JSON.parse(read("package.json"))
);
packageJson.name = config.app.name;
packageJson.version = version;
write("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);

const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
tauri.productName = config.app.title + (profile === "mock" ? " Mock" : "");
tauri.identifier = identifier;
tauri.version = version;
tauri.bundle.publisher = config.app.author;
tauri.bundle.targets = profile === "mock" ? ["msi"] : "all";
tauri.bundle.windows.wix.componentRefs = [config.msi.component_id];
tauri.bundle.windows.wix.upgradeCode = msi.upgrade_code;
tauri.plugins.uxuescript = {
  msi: {
    componentId: config.msi.component_id,
    valueName: config.msi.value_name,
    value: config.msi.value,
    keys: {
      [config.app.identifier]: config.msi.default.key,
      [config.app.mock_identifier]: config.msi.mock.key,
    },
  },
};
tauri.plugins.updater.endpoints =
  profile === "mock"
    ? [`http://127.0.0.1:${config.updater.mock.port}/latest.json`]
    : config.updater.endpoints;
tauri.plugins.updater.pubkey = config.updater.pubkey;
if (profile === "mock")
  tauri.plugins.updater.dangerousInsecureTransportProtocol = true;
else delete tauri.plugins.updater.dangerousInsecureTransportProtocol;
write("src-tauri/tauri.conf.json", `${JSON.stringify(tauri, null, 2)}\n`);

const dom = new JSDOM(read("src-tauri/windows/fragments/updater-marker.wxs"), {
  contentType: "text/xml",
});
const { document } = dom.window;
const component = document.querySelector("Component");
const registryKey = document.querySelector("RegistryKey");
const registryValue = document.querySelector("RegistryValue");
if (!component || !registryKey || !registryValue)
  throw new Error("MSI marker XML is missing its component or registry values");
component.setAttribute("Id", config.msi.component_id);
component.setAttribute("Guid", msi.guid);
registryKey.setAttribute("Key", msi.key);
registryValue.setAttribute("Name", config.msi.value_name);
registryValue.setAttribute("Value", String(config.msi.value));
write(
  "src-tauri/windows/fragments/updater-marker.wxs",
  `<?xml version="1.0" encoding="UTF-8"?>\n${new dom.window.XMLSerializer().serializeToString(document)}\n`,
);

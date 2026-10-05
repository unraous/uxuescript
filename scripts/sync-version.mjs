import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cargoTomlPath = resolve(root, "src-tauri/Cargo.toml");
const packageJsonPath = resolve(root, "package.json");
const tauriConfigPath = resolve(root, "src-tauri/tauri.conf.json");
const metadataPath = resolve(root, "src-tauri/src/config/metadata.rs");
const coreScriptPath = resolve(root, "src-tauri/src/scripts/core.js");

function readUtf8(path) {
  return readFileSync(path, "utf8");
}

function replaceExactlyOnce(source, pattern, replacement, path) {
  const matches = source.match(pattern);
  if (matches?.length !== 1) {
    throw new Error(
      `${path}: expected exactly one version marker, found ${matches?.length ?? 0}`,
    );
  }
  return source.replace(pattern, replacement);
}

function main() {
  const cargoToml = readUtf8(cargoTomlPath);
  const versionMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
  const version = versionMatch?.[1];
  if (!version) {
    throw new Error(`${cargoTomlPath}: missing package.version`);
  }

  const packageJson = JSON.parse(readUtf8(packageJsonPath));
  packageJson.version = version;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const tauriConfig = JSON.parse(readUtf8(tauriConfigPath));
  tauriConfig.version = version;
  writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);

  const metadata = replaceExactlyOnce(
    readUtf8(metadataPath),
    /version:\s*"[^"]+"\.into\(\),/g,
    `version: "${version}".into(),`,
    metadataPath,
  );
  writeFileSync(metadataPath, metadata);

  const coreScript = replaceExactlyOnce(
    readUtf8(coreScriptPath),
    /(\[使用须知与运行指南 v)[^\]]+(\])/g,
    `$1${version}$2`,
    coreScriptPath,
  );
  writeFileSync(coreScriptPath, coreScript);

  console.log(`Synchronized release version ${version}.`);
}

try {
  main();
} catch (error) {
  console.error(`Version synchronization failed: ${error.message}`);
  process.exitCode = 1;
}

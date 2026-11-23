import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { format } from "prettier";
import { scriptAliases } from "./script-aliases.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = /** @type {typeof import("../config/build.json")} */ (
  JSON.parse(readFileSync(resolve(root, "config/build.json"), "utf8"))
);
const entries = /** @type {typeof import("../injected/entries.json")} */ (
  JSON.parse(readFileSync(resolve(root, "injected/entries.json"), "utf8"))
);
const homepage = "https://github.com/unraous/uxuescript";
const download = `${homepage}/releases/latest/download/uxuescript.user.js`;

const metadata = `// ==UserScript==
// @name         uXueScript
// @namespace    ${homepage}
// @version      ${config.version}
// @description  学习通视频、音频与 PDF 课程任务自动处理，支持视频内互动题与批注自动继续学习。
// @author       ${config.app.author}
// @license      GPL-3.0-only
// @homepageURL  ${homepage}
// @supportURL   ${homepage}/issues
// @match        *://mooc1.chaoxing.com/mycourse/studentstudy*
// @run-at       document-idle
// @noframes
// @grant        none
// @updateURL    ${download}
// @downloadURL  ${download}
// ==/UserScript==

`;

export async function buildScripts({
  output = resolve(root, "dist/scripts"),
  watch = false,
} = {}) {
  for (const [name, source] of Object.entries(entries)) {
    const entry = `${name}.js`;
    const virtualEntry = "\0uxs:entry";
    const modulePath = resolve(root, "injected", source).replaceAll("\\", "/");
    /** @type {import("vite").Rolldown.OutputOptions[]} */
    const outputs = [
      {
        format: /** @type {const} */ ("iife"),
        name: "uXueScript",
        entryFileNames: `embedded/${entry}`,
        minify: true,
      },
    ];
    if (entry === "core.js") {
      const readable = {
        ...outputs[0],
        entryFileNames: entry,
        minify: false,
        topLevelVar: false,
      };
      outputs.push(readable);
      outputs.push({
        ...readable,
        entryFileNames: "uxuescript.user.js",
        banner: metadata,
      });
    }
    const result = await build({
      configFile: false,
      publicDir: false,
      resolve: { alias: scriptAliases },
      plugins: [
        {
          name: "injected-entry",
          resolveId(id) {
            if (id === "virtual:uxs-entry") return virtualEntry;
          },
          load(id) {
            if (id === virtualEntry) {
              return `import { main } from ${JSON.stringify(modulePath)};\nmain();`;
            }
          },
        },
        {
          name: "readable-injected-scripts",
          async generateBundle(_options, bundle) {
            if (_options.minify) return;
            for (const chunk of Object.values(bundle)) {
              if (chunk.type !== "chunk") continue;
              chunk.code = await format(chunk.code, {
                parser: "babel",
                tabWidth: 2,
                useTabs: false,
              });
            }
          },
        },
      ],
      build: {
        outDir: output,
        emptyOutDir: false,
        target: "esnext",
        minify: false,
        reportCompressedSize: false,
        watch: watch ? {} : null,
        rolldownOptions: {
          input: "virtual:uxs-entry",
          experimental: { attachDebugInfo: "none" },
          output: outputs,
        },
      },
    });
    if (watch) {
      await new Promise((resolve, reject) =>
        /** @type {Extract<Awaited<ReturnType<typeof build>>, { on: unknown }>} */ (
          result
        ).on("event", (event) => {
          if (event.code === "ERROR") reject(event.error);
          if (event.code === "END") resolve();
        }),
      );
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await buildScripts({
    output: resolve(
      root,
      process.argv.slice(2).find((arg) => !arg.startsWith("--")) ??
        "dist/scripts",
    ),
    watch: process.argv.includes("--watch"),
  });
}

# Task-Specific Engineering Guidance

Read only the sections that apply to the current task. The repository-wide rules are in [`../AGENTS.md`](../AGENTS.md).

## Code Generation and Architecture

- Before changing macros, handlers, or generated code, inspect the existing `auto_handler` pipeline and relevant helper crates. Extend that pipeline where it already owns the behavior; avoid duplicate scripts, ad-hoc AST string parsers, or scattered initialization.
- For Rust type reflection and TypeScript bindings, prefer compiler-supported mechanisms or established crates such as `tauri_specta` over a custom string-to-type mapper. A local implementation is reasonable only when the existing tools do not meet a demonstrated requirement; explain that requirement.
- Keep related compile-time outputs, such as permission JSON and TypeScript bindings, coordinated within the existing macro traversal when extending it. Keep `src/lib.rs` and `src/main.rs` free of generation/export boilerplate.
- Preserve the primary Tauri handler routing, including unannotated IPC commands, when adding sub-system helpers or macro expansions.

## Proportional Layout

- The project intentionally aligns CSS `vw`, `vh`, `%`, and flex proportions with Rust `LogicalSize` factors in `webview.rs`. Check both sides of a layout change.
- Do not call a proportional factor a "hardcoded hack" solely because it is numeric. Judge whether it maintains the intended alignment across window sizes.

## Data and Code Organization

- Keep `LLMConfig`, `LLMProvider`, and similar config/payload structs as pure data. Put locking and operations in command or service handlers, not getters, setters, callbacks, or mutex methods on DTOs.
- Group templates by directory (for example, `requests/default.json`) without repeating the directory name in filenames.
- Split genuinely monolithic match blocks into focused helpers. Avoid repeating module or protocol prefixes in names already scoped by a submodule.
- In Rust, do not use `ref` when matching `Copy` or reference types such as `Option<&str>`; keep Serde attributes minimal.

## Standalone Script Contract

- `src-tauri/src/scripts/core.js` is intentionally one self-contained delivery artifact: it must work both by direct browser-console copy/injection and by Tauri `include_str!` plus WebView `eval`. Do not introduce imports or splitting that breaks direct-copy execution. Judge its internal boundaries and behavior, not its physical file count.
- Preserve progressive enhancement: without Tauri, the script uses defaults and handles supported non-Quiz tasks; with Tauri, it gains configuration, Quiz solving, and status IPC. This dual mode predates the Tauri rewrite and is a product contract inherited from `uXuexitongJS`.
- Chaoxing DOM dependence is inherent to third-party page automation. Assess selector isolation, waits, iframe transitions, and failure boundaries rather than treating DOM dependence itself as a defect.

## WebView Behavior

- Base remote WebView security findings on the effective label, remote-origin scope, capability merging, and exact allowed commands; the presence of Tauri IPC alone does not imply broad access.
- Verify startup and navigation conclusions against actual WebView creation order and logs. WebView2 initial navigation is timing-sensitive; do not add startup `reload` calls without evidence of the state being fixed.

## Review and Reporting

- Use evidence in this order: current code and worktree; normal-user call paths and runtime logs; Git history and prior implementations; generic framework conventions. Prefer observed event order over assumed Vue, Tauri, or WebView lifecycle behavior.
- A static possibility is only a candidate issue. Establish reachability, frequency, and impact before calling it a normal-use reliability problem.
- Classify findings before judging them:
  - **Current normal-path defect:** reachable in ordinary use now.
  - **Exceptional-path risk:** requires a failure, unusual concurrency, invalid state, or rare environment.
  - **Completion or migration gap:** planned or previously implemented behavior not yet restored.
  - **Intentional tradeoff or product constraint:** preserves a required delivery or compatibility property.
  - **Removed experiment or historical regression:** historical evidence, not a current defect.
  - **Cross-version capability gap:** repeatedly absent across versions with no contrary design evidence.
  Do not use completion gaps, deliberate constraints, or removed experiments as evidence of poor current runtime quality.
- Keep feature completeness separate from code quality; current code quality from author capability; normal-use reliability from defensive hardening; AI-assisted volume from technical ownership; and file splitting from logical modularity or delivery requirements.
- When assessing project evolution or author capability, inspect Git history and, when available, `../uXuexitongJS`. Do not infer inability from one in-progress snapshot. Large diffs or deleted code do not alone prove expensive failed experimentation.
- README, release notes, and public documentation may be deferred until release; assess them against the actual project stage and historical workflow.
- Lead with verified behavior and evidence, not a score or generic checklist. State uncertainty where intent, runtime reachability, or historical cost cannot be proven; do not manufacture weaknesses for balance. Treat claims about age, seniority, rarity, or growth rate as inferences, not repository facts.

## Zed and Agent Environment

- The Zed terminal and Agent command runner may have different sandbox access even on the same Windows machine. If a command works for the user but not the Agent, check `Get-Command <command> | Format-List CommandType,Source,Definition` and `<command> --version` in the user's terminal before concluding it is unavailable.
- Treat `Access is denied` for a known user-level executable as a possible sandbox or permission boundary. Do not tell the user to reinstall pnpm solely from an Agent-runner failure, or change source, lockfiles, or build scripts to work around that boundary. Use the Zed terminal or request access when needed.
- When using ACP file-edit tools in Zed, pass raw multiline text with actual line breaks, never manually double-escaped `\n` literals.
- Prefer `client_*` editing tools for Zed buffer synchronization **when those tools are available**. In other environments, use the available file-edit mechanism.

# Repository Agent Instructions

## Always

- Follow the user's scope and verified project facts. Use current code and normal call paths before generic framework assumptions; correct dependent conclusions when a premise changes.
- Preserve existing and untracked worktree changes unless the user explicitly identifies them as yours to change.
- Before adding defensive code such as a guard, fallback, or lifecycle check, decide whether the actual business flow or a realistic failure case needs it. Do not add checks for merely imagined states. When the reason is not obvious, add a concise comment explaining when the case occurs and why it needs handling.
- Reserve silent `null` or empty returns for expected absence. If an unexpected state is converted to a sentinel so execution can continue, log a warning with enough context to diagnose it; otherwise propagate or raise the error instead of returning silently.
- Inspect nearby patterns before introducing a new helper or pipeline, in proportion to the task. Do not require a full architecture audit for a small, local edit.
- Communicate directly: skip praise and generic "best practice" preambles; explain concrete risks or tradeoffs when they matter.
- When a question calls for a conclusion, lead with a clear answer and take a definite position. Make the best judgment supported by the available evidence; be willing to be wrong, then acknowledge and correct mistakes directly. Do not evade conclusions through excessive caveats, irrelevant theoretical exceptions, or presenting both sides without choosing. If essential evidence is missing, identify it and still state the best-supported current judgment without inventing facts.
- User and system instructions take precedence over this file and the linked engineering guidance.

## Commits

- All commits must use `git cz`; its configured workflow is the authority for commit messages.
- Before concluding that `git cz` is unavailable, check the normal user shell and existing user-level installation paths. An Agent sandbox or PATH failure does not establish that the tool is not installed; use the existing installation through an authorized execution context when available.
- If `git cz` is unavailable, pause committing and ask the user whether to install it. Do not install it without approval or substitute a manually formatted `git commit`.

## Releases

- When the user specifies a release version without explicitly saying otherwise, it refers to the `v`-prefixed Release tag (for example, `v2.5.3`). Keep package and build configuration versions in their required unprefixed format.

## Read the Relevant Engineering Guidance

Before changing code, organizing commits, or preparing a release, read the relevant entries in [`LESSONS.md`](LESSONS.md). It records verified AI collaboration mistakes and the rules that would have prevented them; update it when a correction exposes a new recurring risk.

Follow the shared design principles in [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) when writing or reviewing code. It defines coding conduct, file independence, side-effect scope, and structural boundaries.

Use the [architecture overview](docs/architecture/overview.md) for subsystem boundaries, the [build guide](docs/development/build.md) for development and generation commands, the [test guide](tests/README.md) for validation, and the [release guide](docs/development/release.md) for delivery.

Keep documentation within its subject: record necessary contracts, design reasons, and operations; keep related explanations locally complete and link directly to another subject only when needed. Update the owning document rather than duplicating implementation details or appending task history.

The detailed rules in [`.agents/AGENTS.md`](.agents/AGENTS.md) are task-specific. Read the matching section before work in that area; do not load every section for an unrelated change.

- Rust macros, handler registration, or generated bindings: [Code generation and architecture](.agents/AGENTS.md#code-generation-and-architecture).
- CSS, Vue layout, native window sizing, or alignment: [Proportional layout](.agents/AGENTS.md#proportional-layout).
- Config DTOs, templates, or Rust naming: [Data and code organization](.agents/AGENTS.md#data-and-code-organization).
- `injected/` or its build/injection paths: [Standalone script contract](.agents/AGENTS.md#standalone-script-contract). The self-contained delivery contract applies to bundled `dist/scripts/*.js`; source modules may use imports.
- Tauri WebView security, startup, or navigation: [WebView behavior](.agents/AGENTS.md#webview-behavior).
- Repository review, diagnosis, or author/project assessment: [Review and reporting](.agents/AGENTS.md#review-and-reporting).
- Zed terminal, Agent runner, pnpm access, or ACP tools: [Zed and Agent environment](.agents/AGENTS.md#zed-and-agent-environment).

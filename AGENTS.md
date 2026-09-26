# Repository Agent Instructions

## Always

- Follow the user's scope and verified project facts. Use current code and normal call paths before generic framework assumptions; correct dependent conclusions when a premise changes.
- Preserve existing and untracked worktree changes unless the user explicitly identifies them as yours to change.
- Before adding defensive code such as a guard, fallback, or lifecycle check, decide whether the actual business flow or a realistic failure case needs it. Do not add checks for merely imagined states. When the reason is not obvious, add a concise comment explaining when the case occurs and why it needs handling.
- Inspect nearby patterns before introducing a new helper or pipeline, in proportion to the task. Do not require a full architecture audit for a small, local edit.
- Communicate directly: skip praise and generic "best practice" preambles; explain concrete risks or tradeoffs when they matter.
- User and system instructions take precedence over this file and the linked engineering guidance.

## Read the Relevant Engineering Guidance

The detailed rules in [`.agents/AGENTS.md`](.agents/AGENTS.md) are task-specific. Read the matching section before work in that area; do not load every section for an unrelated change.

- Rust macros, handler registration, or generated bindings: [Code generation and architecture](.agents/AGENTS.md#code-generation-and-architecture).
- CSS, Vue layout, native window sizing, or alignment: [Proportional layout](.agents/AGENTS.md#proportional-layout).
- Config DTOs, templates, or Rust naming: [Data and code organization](.agents/AGENTS.md#data-and-code-organization).
- `src-tauri/src/scripts/core.js` or its injection paths: [Standalone script contract](.agents/AGENTS.md#standalone-script-contract).
- Tauri WebView security, startup, or navigation: [WebView behavior](.agents/AGENTS.md#webview-behavior).
- Repository review, diagnosis, or author/project assessment: [Review and reporting](.agents/AGENTS.md#review-and-reporting).
- Zed terminal, Agent runner, pnpm access, or ACP tools: [Zed and Agent environment](.agents/AGENTS.md#zed-and-agent-environment).

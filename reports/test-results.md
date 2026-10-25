# V0.2 Test Results (this round)

- Isolated worktree: `<MIGRATION_REPO>`
- Date: 2026-10-25
- Statuses are only for **this round**; no historical PASS is reused.

## Environment

| Item | Value |
|---|---|
| OS | Windows (host SAC active) |
| Node | 24.19.0 (`.node-version` requests 24.21.0; not changed) |
| Cargo | 1.99.1 |
| Rustc | 1.99.1 |
| Default LLD | absent (`lld-link.exe` not found) |
| Rust linker workaround | process env `CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER` = MSVC `link.exe` |
| Extra RUSTFLAGS | none |
| Frontend modules | read-only junction to existing V0.2 `node_modules` (no install) |
| npm/pnpm registry | unreachable; no dependency install |

## PASS

### 1. Node safety policy/controller tests

```powershell
node tests/security/safety.test.mjs
```

**PASS**, exit 0. Covers fill/submit separation, graded/restricted denial,
fill-only policy, mandatory submit assertion, pause blocking checkpoint, resume,
and stop throwing `TaskStopped`.

Log: `reports/logs/safety.log`

### 2. Static security assertions

```powershell
node tests/security/static.test.mjs
```

**PASS**, exit 0. Covers focus-spoof removal, exam entry not using
`answerPage`/`answerPaged`/`topreview`, quiz/interactive policy/assert/checkpoint,
dispatcher body-leak removal and all-batch guard, `ProviderView.has_key`, and
removed WebView2 throttling flags.

Log: `reports/logs/static.log`

### 3. JavaScript syntax

`node --check` over all `injected/**/*.js` and `tests/security/*.mjs`.

**PASS**, 0 syntax failures.

### 4. Browser userscript/script build

```powershell
node scripts/build-scripts.mjs
```

**PASS**, exit 0. It built `dist/scripts/embedded/*.js`,
`dist/scripts/core.js`, and `dist/scripts/uxuescript.user.js` from the migrated
`injected/entries.json` graph. This is the existing project build script, not a
manual bundle.

Log: `reports/logs/build-scripts.log`

### 5. Rust check

```powershell
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = <MSVC link.exe>
cargo check --workspace --locked -j 1
```

**PASS**, exit 0. `--locked`; no RUSTFLAGS; process-level linker override only.
MSVC linker emits `LNK4044: /THREADS:16` ignored (from `.cargo/config.toml`);
this is a warning, not a source error.

This is **not** a default LLD build. The default `cargo` configuration still
lacks `lld-link.exe`, so the default build is a separate BLOCKED item.

Log: `reports/logs/cargo-check.log`

### 6. Rust workspace tests

```powershell
cargo test --workspace --locked -j 1
```

**PASS**, exit 0.

| Crate | Passed | Failed | Ignored |
|---|---|---|---|
| `uxs_commands` | 17 | 0 | 0 |
| `uxuescript` | 52 | 0 | 13 |
| Doc tests | 0 | 0 | 0 |

The 13 ignored tests are upstream live/network tests requiring real provider
keys, Ollama, or a long-running benchmark. No ignored test is counted as a
pass. The fake-key DPAPI unit tests (`test_api_key_serialization...`,
`test_provider_view_never_contains_the_key`, `base64_roundtrip...`) passed on
Windows. No real API key was read.

Log: `reports/logs/cargo-test.log`

### 7. Diff hygiene

```powershell
git diff --check
```

**PASS**, exit 0 (only Git LF/CRLF informational warnings).

Log: `reports/logs/diff-check.log`

## BLOCKED / FAIL

### Frontend TypeScript/Vue typecheck — BLOCKED

```powershell
node scripts/typecheck.cjs --noEmit
```

Exit 1. Existing V0.2 `node_modules` has TypeScript 7.0.2, while upstream 2.5.1
expects the `@typescript/typescript6` compatibility package via
`require.resolve("typescript/lib/tsc")`; that fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED`. `@types/jsdom` is also absent. npm is
unreachable, and installing/upgrading is outside this round. Not a source PASS.

Log: `reports/logs/typecheck.log`

### ESLint — BLOCKED

Exit 2: `typescript-eslint` 8.71.1 rejects TypeScript 7.0.2 ("does not support
TS 7.0"). Upstream expects TypeScript 6. No lint pass is claimed.

Log: `reports/logs/eslint.log`

### Vitest — BLOCKED

Exit 1 at startup: rolldown cannot find its native binding
(`@rolldown/binding-wasm32-wasi` / `rolldown-binding.wasi.cjs`; the Windows
native module is subject to SAC). SAC was not disabled and no module was
replaced. No test was run, so adapted Vitest tests are **NOT TESTED**.

Log: `reports/logs/vitest.log`

### Vite production build — NOT TESTED / BLOCKED

Not run because the same missing rolldown/native dependency and frontend
dependency mismatch block the toolchain. `build-scripts` is a separate,
successful Vite script-bundle path and is not evidence that the full app build
passes.

### `cargo fmt --check` — FAIL

```powershell
cargo fmt --all -- --check
```

Exit 1. Diffs include pre-existing upstream files plus some changed Rust lines.
Formatting was not rewritten, because unrelated formatting would enlarge the
diff and the project's CI does not run fmt. This is a formatting-only failure,
not a compile/test failure.

Log: `reports/logs/cargo-fmt.log`

### GUI/DPAPI/SAC validation — NOT TESTED

- Windows GUI lifecycle, pause/resume panel, close timeout: **NOT TESTED**.
- Real DPAPI prompt/real key: **NOT TESTED** (only fake-key unit tests).
- Real course/platform submission: **NOT TESTED**, forbidden.
- SAC-blocked native modules: **BLOCKED**, not bypassed.

## Summary

| Check | Status |
|---|---|
| Node safety policy/controller | PASS |
| Node static security | PASS |
| JS syntax | PASS |
| Browser scripts build | PASS |
| Rust check (process linker override) | PASS |
| Rust workspace tests | PASS (69 passed, 13 ignored) |
| `git diff --check` | PASS |
| TypeScript/Vue typecheck | BLOCKED |
| ESLint | BLOCKED |
| Vitest | BLOCKED |
| Vite app build | BLOCKED / NOT TESTED |
| Rust fmt | FAIL (formatting only) |
| Default LLD build | BLOCKED |
| Windows GUI/DPAPI | NOT TESTED |
| Real course | NOT TESTED |
| CI | NOT TRIGGERED |

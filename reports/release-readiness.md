# V0.2 Release Readiness

**Decision: NOT READY for release.** The migration is a reviewable candidate,
not a verified production build.

## Readiness checklist

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | New-architecture security mapping complete | **PARTIAL** | Mapping implemented; frontend/GUI paths unverified |
| 2 | Core policy tests pass | **PASS (local Node)** | `tests/security/safety.test.mjs` exit 0 |
| 3 | Rust checks pass | **PASS (override)** | `cargo check`/`cargo test` exit 0: 69 passed, 13 ignored, 0 failed; process-level MSVC linker override, not default LLD |
| 4 | Frontend checks pass | **BLOCKED** | TypeScript 7 vs upstream TS6 dependency mismatch; `@types/jsdom` absent; npm unreachable |
| 5 | Windows DPAPI/GUI lifecycle evidence | **NOT TESTED** | No real key, no GUI run, no close/DPAPI prompt test |
| 6 | CSP solution + verification plan | **BLOCKED** | `src-tauri/tauri.conf.json` still `csp: null`; protected, not modified |
| 7 | Dependency advisory assessment | **NOT DONE** | No `cargo audit`/`cargo deny`; no advisory review |
| 8 | Build toolchain/min CPU clear | **PARTIAL** | LLD absent; process-level MSVC linker override only; upstream `x86-64-v3` config not release-verified |
| 9 | Signing/trusted build | **BLOCKED** | No Authenticode/signing config; Tauri updater signature is not publisher code signing |
| 10 | Version/installer/upgrade/rollback | **NOT VERIFIED** | 2.5.1 MSI/updater not built/tested; no install/upgrade test |
| 11 | All blockers listed | **DONE** | This document |

## Release-blocking issues

### 1. Frontend cannot be verified in this environment

- Existing dependencies are V0.2/2.4.1-era and do not match upstream 2.5.1:
  - project script needs `typescript` aliased to `@typescript/typescript6`;
    local `typescript` is 7.0.2 and fails `ERR_PACKAGE_PATH_NOT_EXPORTED`.
  - `@types/jsdom` is missing.
  - npm registry is unreachable; installing is outside this round.
- Vitest/Vite are additionally blocked by SAC's unsigned rolldown native module.
- Therefore **no current Vitest, typecheck, or full Vite app build PASS exists**.
  The standalone browser userscript/script build (`node scripts/build-scripts.mjs`)
  did pass this round, but it is not evidence that the full application build
  passes.

### 2. Rust verification incomplete for a default build

- Default Windows build has no `lld-link.exe`; only a process-level MSVC linker
  override was used.
- The override is not a default-configuration build and cannot be presented as
  release evidence.
- `cargo check` and `cargo test` did pass under that override (69 passed, 13
  ignored, 0 failed); `cargo fmt --check` still fails for formatting-only diffs.

### 3. CSP is still `null`

`src-tauri/tauri.conf.json`:

```json
"security": { "csp": null }
```

CSP is a protected release area. No change was made. A reviewed CSP with
allowlists for the Chaoxing pages, Tauri IPC, media, and scripts is still
needed, plus runtime verification. This is a release blocker for a hardened
build.

### 4. No publisher code signing

- No Authenticode configuration or signing command was found.
- `tauri.conf.json` has only Tauri updater signing (`pubkey`); that verifies
  update payloads, not the Windows executable/MSI publisher identity.
- Windows SAC blocks unsigned native modules; an unsigned installer/executable
  is a trust/deployment risk even if the app runs.

### 5. No real Windows GUI/DPAPI evidence

- The DPAPI implementation is raw FFI and has Rust unit tests pending.
- No real DPAPI encrypt/decrypt round trip under the current user was run in
  this migration; no real key was used.
- No pause/resume/stop panel interaction, close timeout, or WebView lifecycle
  was tested in a GUI.

### 6. No CI evidence

No push, PR update, or workflow trigger was authorized/performed. Ubuntu CI has
not run for this branch. Local Windows results cannot be substituted for CI.

## What is reasonably verified

- Node safety policy/controller tests: PASS.
- Rust workspace check/tests: PASS under process-level MSVC linker override
  (69 passed, 13 ignored, 0 failed).
- Browser userscript/script build: PASS.
- Static submit-path/focus/dispatcher/API-view assertions: PASS.
- JS syntax and `git diff --check`: PASS.
- Source review shows protected files unchanged.
- Submission paths are gated before fill/submit; formal exams are manual-only;
  partial AI results are not submitted.

These are necessary but **not sufficient** for release.

## Minimum safe path to release

1. Validate a default LLD build or formally approve the MSVC linker override as
   the supported Windows build contract; the current override is not release
   evidence for the default configuration.
2. Run the frontend checks in a properly provisioned, policy-compatible
   environment (no dependency/TS mismatch). Do not disable SAC on the production
   machine to force the result.
3. Run Ubuntu CI on the migration branch (requires explicit remote/CI
   authorization; not part of this round).
4. Validate the Windows GUI: pause/resume/stop, close timeout, DPAPI set/clear,
   fake-key serialization, updater/install/uninstall, rollback.
5. Define and test a CSP; this requires separate approval to modify
   `tauri.conf.json`.
6. Decide Authenticode signing and trusted-build policy; add signing only with
   explicit release authorization.
7. Perform dependency advisory review and compatibility decisions.
8. Re-run the full test matrix on the exact candidate commit and attach logs.

**No release, tag, push, PR update, or Gitee sync was performed.**

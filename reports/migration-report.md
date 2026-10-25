# V0.2 Architecture Migration Report

## Scope

Migrate the V0.2 safety capabilities from the legacy monolith into upstream
2.5.1's modular injected scripts and split Rust dispatcher, without changing
protected build, CI, CSP, or dependency files.

- Migration branch: `migrate/v02-security`
- Base: upstream `main` `21420f28a4d3ea7d6a409f6090143172231fb5e0` (2.5.1)
- Legacy reference: `4fada3777c319eadc5bbcbbab1dff81b6e5793b7`
- No merge commit with `4fada377`; the safety behavior was reimplemented on the
  new architecture.

## Implemented changes

### 1. New safety module

`injected/chaoxing/safety.js` (new, no project imports):

- `AutomationStopped`, `ManualReviewRequired`, `TaskStopped`
- `classifyTaskPolicy` for Video/Audio/PDF/Quiz/Other
- `resolveQuizPolicy` with independent fill and submit authorization
- `resolveFillPolicy` for work/non-quiz writes (never allows submit)
- `assertSubmitAllowed`
- `controller` with IDLE/RUNNING/PAUSING/PAUSED/STOPPING/STOPPED/FAILED,
  checkpoint, media pause/resume, fixed control panel
- `showManualReviewPanel` with answers for human review; closing stops the task
- Graded/exam/restricted signals force `allowFill=false`, `allowSubmit=false`
- "非计分/不计分/ungraded/practice" is the only negative graded signal

### 2. Quiz and interactive quiz

- `course/chapter/tasks/quiz.js`
  - policy resolved **before** extracting or solving questions
  - denied pages never call solve/fill/submit
  - incomplete AI answers are shown for review but not filled/submitted
  - fill authorization and submit authorization are separate
  - mandatory final human confirmation before submit
  - checkpoint + `assertSubmitAllowed` immediately before submit and modal
  - removed the legacy 30-second repeated review loop
- `course/chapter/tasks/interactive.js`
  - policy resolved **before** platform answer validation
  - fill-only path stops with a manual panel
  - final review mandatory; checkpoint/assert before submit/continue
  - logs no per-candidate answer content
  - answer-failure panel no longer dumps full Ext data

### 3. Course lifecycle and controller

- `course.js`: controller start/finish; course records cancel on
  `AutomationStopped`; removed `preserveFocusState`.
- `course/runtime.js`: `safeRun` rethrows `AutomationStopped` so stop/denial
  cannot be swallowed.
- `utils/async.js`: every `wait.until` polls `controller.checkpoint()`.
- `course/chapter/tasks.js`: classification log, per-task checkpoint, stop-aware
  task-point observer.
- `course/chapters.js`: stop-aware locked-chapter wait and checkpoints.
- `course/chapter/tasks/timeline.js`: stop-aware timeline wait.
- `annotation.js`: checkpoint before "continue learning".
- `video.js`/`audio.js`: register media with controller; audio no longer seeks
  to the last second; mute/speed retained.
- `questions/page.js`: checkpoint before each answer fill.

### 4. Exam and work

- `exam.js`: formal exam entry is now **manual-only**; it never calls
  `answerPage`, `answerPaged`, or `topreview`.
- `work.js`: requires `resolveFillPolicy` (fill-only authorization), shows a
  manual panel on denial, saves a draft only, and never auto-submits.
- `exam/paged.js` remains as upstream code but is not imported by `exam.js`;
  the live entry cannot reach it. This dead path is flagged in the diff review.

### 5. Anti-detection removal

- Deleted `injected/chaoxing/focus.js` (event blocking + fake Page Visibility /
  focus API).
- Removed its import/call from `iframe-init.js` and `course.js`.
- `lib.rs`: removed WebView2 flags that disabled background timer/renderer/
  occlusion throttling and media suspend; kept only the UI language flags.

### 6. AI dispatcher

- `dispatcher.rs`: 60-second reqwest timeout; successful batches retained;
  failed batches represented by explicit empty/placeholder answers; all-batch
  failure returns a clear no-submit error.
- `chat.rs`/`responses.rs`/`gemini.rs`: no response body or raw JSON in errors;
  status-only protocol errors and generic extraction errors.
- Client (`quiz.js`) refuses to fill/submit an incomplete answer set.

### 7. API key, config, window

- New `src-tauri/src/secret_store.rs`:
  - Windows DPAPI via direct `crypt32` FFI, no Cargo dependency change
  - prefix `dpapi:v1:`; legacy plaintext accepted once
  - test-only base64 fallback on non-Windows
- `config/llm.rs`:
  - manual `Serialize`/`Deserialize` for `ApiKey`
  - Display/Debug fully redacted (`***REDACTED***`)
  - new `ProviderView` without `api_key`, with `has_key`
- `commands/config/llm.rs`:
  - `providers()` returns `ProviderView`
  - `upsert_provider` preserves an existing key when none is supplied
  - `set_key`, `clear_key`
- `permissions/commands-main.json`: allow `clear_key`.
- `config.rs`: load failure sets a flag; save refuses to overwrite; temp file +
  backup + rename (copy fallback on Windows); no destructive fallback.
- `app/window.rs`: `CLOSING` guard and 2 s close timeout.
- Frontend:
  - `LLMProvider` no longer carries `apiKey`
  - `TheAPIPanel.vue` only accepts a new key, shows `hasKey`, has Save/Clear,
    never displays old key
  - new labels and `clearKey` command binding

## Protected files

The migration branch has **no diff** in:

- `.github/workflows/*` (none)
- `src-tauri/tauri.conf.json`
- `Cargo.toml`, `Cargo.lock`
- `package.json`, `pnpm-lock.yaml`
- dependency versions/manifests

`Cargo.lock`/`pnpm-lock.yaml` hashes differ from the legacy V0.2 worktree only
because they are upstream 2.5.1's committed lockfiles; they are unchanged from
the migration base (`git diff HEAD --` empty).

## Tests changed

- Rewrote the old quiz-review tests that expected auto-submit with review
  disabled and a repeated 30-second loop. The new tests require fill
  authorization, submit authorization, and final review; denial stops submit.
- Rewrote exam-entry tests: formal exam must show a manual panel and never call
  preview/paged/fill.
- Updated audio tests: no end-seek; duration wait retained.
- Updated work tests for fill authorization, no auto-submit.
- Adapted API panel/provider tests for `hasKey` and no `apiKey` field.
- Added Node-native `tests/security/safety.test.mjs` and
  `tests/security/static.test.mjs`.

No test is skipped or weakened to obtain a pass. Tests asserting unsafe
behavior were replaced with stricter assertions.

## Known limitations

- Frontend Vitest/Vite/typecheck/ESLint could not run in this environment:
  upstream 2.5.1 expects a TypeScript 6 compatibility package and
  `@types/jsdom` that are absent from the existing 2.4.1 `node_modules`;
  npm network is unavailable; Vitest is also blocked by SAC's rolldown native
  module policy. See `test-results.md`.
- Rust `cargo check --workspace --locked` and `cargo test --workspace --locked`
  passed with a process-level MSVC linker override (69 passed, 13 ignored,
  0 failed). The default LLD configuration is still absent and was not verified.
- `node scripts/build-scripts.mjs` passed and produced the embedded scripts.
- No Windows GUI, real DPAPI prompt, CSP, installer, or real-course test.
- No CI run and no push/PR/release.

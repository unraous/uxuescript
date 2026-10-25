# V0.2 Diff and Security Review

**Review result: PARTIAL — not a release pass.**

The source diff is small enough to enumerate (40 tracked files, plus 2 new
source files, 2 new security tests and 7 reports), and no protected file was
changed. Runtime verification is incomplete because frontend and Windows GUI
checks are blocked; therefore this document does not claim a complete security
pass.

## Protected-area check

| Area | Diff | Status |
|---|---|---|
| `.github/workflows/*` | none | PASS |
| `src-tauri/tauri.conf.json` (CSP/release) | none | PASS (CSP remains `null`) |
| `Cargo.toml`, `Cargo.lock` | none | PASS |
| `package.json`, `pnpm-lock.yaml` | none | PASS |
| dependency versions/manifests | none | PASS |
| `src-tauri/permissions/commands-main.json` | adds `clear_key` only | reviewed, not a protected release file |
| `.cargo/config.toml` | none | PASS |

`git diff HEAD -- Cargo.lock pnpm-lock.yaml` is empty. Their hashes differ from
the legacy V0.2 tree because they are upstream 2.5.1's committed locks.

## File list

### Added

- `injected/chaoxing/safety.js`
- `src-tauri/src/secret_store.rs`
- `tests/security/safety.test.mjs`
- `tests/security/static.test.mjs`
- `reports/migration-baseline.md`
- `reports/security-mapping.md`
- `reports/migration-report.md`
- `reports/test-results.md`
- `reports/diff-security-review.md`
- `reports/release-readiness.md`
- `reports/rollback.md`
- `reports/logs/*` (test evidence)

### Deleted

- `injected/chaoxing/focus.js` (anti-detection: event blocking + fake
  visibility/focus). No test file was deleted.

### Modified

Injected scripts:

- `injected/chaoxing/course.js`
- `course/runtime.js`
- `course/chapters.js`
- `course/chapter.js` (unchanged)
- `course/chapter/tasks.js`
- `course/chapter/tasks/{annotation,audio,interactive,quiz,timeline,video}.js`
- `injected/chaoxing/exam.js`
- `injected/chaoxing/iframe-init.js`
- `injected/chaoxing/questions/page.js`
- `injected/chaoxing/runtime.js`
- `injected/chaoxing/work.js`
- `injected/utils/async.js`

Rust:

- `src-tauri/src/lib.rs`
- `src-tauri/src/app/window.rs`
- `src-tauri/src/config.rs`
- `src-tauri/src/config/llm.rs`
- `src-tauri/src/commands/config/llm.rs`
- `src-tauri/src/core/quiz/llm/dispatcher.rs`
- `src-tauri/src/core/quiz/llm/dispatcher/{chat,responses,gemini}.rs`
- `src-tauri/permissions/commands-main.json`
- `src-tauri/tests/unit/config.rs`
- `src-tauri/tests/unit/config/llm.rs`

Frontend/tests:

- `src/components/TheConfigPanel/TheAPIPanel.vue`
- `src/composables/useLLMProviders.ts`
- `src/services/cmds.ts`
- `src/labels.ts`
- `tests/components/TheAPIPanel.test.ts`
- `tests/composables/useLLMProviders.test.ts`
- `tests/scripts/{core-audio,core-confirm,core-quiz-review,exam-entry,work}.test.js`

## High-risk path review

### Submit paths

| Path | Gate | Review |
|---|---|---|
| Chapter quiz submit `a.btnSubmit` | policy + checkpoint + `assertSubmitAllowed` + mandatory review | OK by source; Vitest blocked |
| Quiz modal `a#popok` | checkpoint + assert immediately before click | OK by source |
| Video interactive `#videoquiz-submit` | policy + review + checkpoint + assert | OK by source; Vitest blocked |
| Video interactive continue | after submit; checkpoint | OK by source |
| Work draft `saveWork` | fill authorization; no submit | OK by source |
| Exam `answerPage`/`answerPaged`/preview | entry removed/blocked | Exam entry test adapted; Vitest blocked |
| `submitForm(true,true)` | no source path found | static search |
| Other click handlers | navigation/play/continue/annotation/login, not task submit | reviewed |

`git diff` and a repository search found no other task-submit click path.

### Policy heuristic residual risk

`resolveQuizPolicy` uses page text. Formal exam entry is unconditionally manual,
and the policy recognizes `正式考试/考试/计分/graded/exam`; a contradictory
"非计分考试" is treated as graded. A graded quiz whose page contains none of
these signals still depends on the user answering the fill/submit prompts
truthfully. This is a residual product risk, not hidden automation. Tests cover
the known signals and fail-closed default.

### AI dispatcher

- 60 s timeout.
- Successful batches retained; failed batches become empty placeholder answers.
- Client refuses to fill/submit incomplete answers.
- Protocol errors no longer include response bodies or raw JSON.
- All batches failing returns an error.
- No fake answers are generated.

### API key

- `providers()` returns `ProviderView`, never `api_key`.
- `ProviderView.has_key` is the only key status.
- `ApiKey::Display/Debug` fully redacted.
- Config serialization encrypts through DPAPI; legacy plaintext accepted and
  re-encrypted on save.
- `upsert_provider` preserves an existing key when the frontend omits it.
- `clear_key` is explicit and permissioned.
- Frontend input is always blank; old key is never rendered.
- No real key was read; tests use a fake value.

### Config and window

- Load failure sets `CONFIG_LOAD_FAILED`; save refuses to overwrite.
- Save writes temp + backup; Windows rename fallback uses a checked copy.
- Close guard prevents duplicate cleanup; 2 s timeout.
- GUI/close behavior **not tested**.

### Anti-detection

- `focus.js` removed; no `preserveFocusState`.
- WebView2 background/renderer/occlusion/media-suspend flags removed.
- No new fake visibility, event interception, or hidden automation added.

## Diff hygiene

- `git diff --check`: PASS.
- `node --check` all injected JS and new `.mjs`: PASS.
- No secret-like literal in the reviewed new/modified source.
- No `.skip`/`.todo`/`xit` introduced in changed tests.
- No test file deleted; unsafe legacy expectations were replaced with stricter
  policy tests, not relaxed.
- Reports contain local paths but no credentials.
- `exam/paged.js` remains as dead upstream code but is not imported by the live
  exam entry. This is recorded as a residual dead-path risk.

## Unresolved review items

1. Frontend typecheck/Vitest/Vite app build not executed.
2. Rust check and tests passed with the process-level MSVC linker override;
   default LLD build remains blocked.
3. Windows GUI, real DPAPI prompt, CSP, installer, signing not tested.
4. `exam/paged.js` dead path remains; no live import.
5. Page-signal heuristic can miss a graded quiz without known wording; user
   confirmation remains the fallback.
6. No dependency advisory review.
7. No CI run.

**Conclusion: source review is acceptable for a review candidate, but not a
release approval.**

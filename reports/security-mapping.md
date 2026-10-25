# V0.2 Security Capability Mapping

Legend: **Implemented** = code exists on `migrate/v02-security`; **Verified**
= this round actually executed and passed; **Blocked** = environment/dependency
block; **Not tested** = no execution this round.

| Security capability | Legacy location | New target | Migration approach | Tests | Status |
|---|---|---|---|---|---|
| Formal/graded/unknown default read-only | `src-tauri/src/scripts/core.js` policy | `injected/chaoxing/safety.js`; quiz/interactive/exam/work gates | New policy module; explicit page signal checks; no auto path for exams | `tests/security/safety.test.mjs`; static test | Implemented; policy Node test PASS |
| Fill authorization separate from submit authorization | `core.js` prompts/policy | `safety.resolveQuizPolicy` | Two independent prompts; policy object carries both flags | safety test (`UNGRADED`, `PRACTICE`) | Implemented; PASS |
| `RESTRICTED` cannot bypass via another submit path | `core.js` | `safety.assertSubmitAllowed`; quiz/interactive submit calls | Submit assertion immediately before every platform submit/confirm click | static test; safety test | Implemented; static PASS |
| Chapter quiz and video interactive quiz share gates | `core.js` | `quiz.js`, `interactive.js` | Both call `resolveQuizPolicy` and `assertSubmitAllowed` | static + adapted Vitest tests | Implemented; static PASS; Vitest blocked |
| Final review before auto-submit | `core.js` review loop | `quiz.js`, `interactive.js` | Mandatory second confirmation, independent of `quizReview` preference | adapted quiz-review tests | Implemented; not executed (SAC) |
| Submit checkpoint / stop race | `core.js` controller | `safety.controller`; `assertSubmitAllowed`; `controller.checkpoint` | Checkpoint before fill and immediately before submit/modal click | safety test | Implemented; controller test PASS |
| AI request timeout | legacy dispatcher | `dispatcher.rs` | 60 s reqwest client timeout | Rust compile/tests | Implemented; compile PASS; timeout not directly exercised |
| Partial batch results | legacy dispatcher | `dispatcher.rs` | Keep successful batches; placeholders for failed question IDs; all-fail errors | Rust unit tests | Implemented; PASS |
| No full model response/body in errors | legacy dispatcher | `chat.rs`, `responses.rs`, `gemini.rs` | Status-only protocol errors; raw response text removed | static test | PASS (source assertion) |
| All batches failed / zero answers -> no submit | legacy dispatcher + quiz | dispatcher error; quiz incomplete-answer guard | All-fail `bail!`; empty answers block fill; client checkpoints | static test; quiz guard | Implemented; Node/static PASS |
| API key not returned to frontend | legacy `ProviderView` | `config/llm.rs::ProviderView`; `providers()` returns views | Drop `api_key`; expose `has_key` only | Rust unit test; static test | Implemented; PASS |
| API key DPAPI at rest | legacy `secret_store.rs` | new `secret_store.rs` | Raw `crypt32` FFI; no new Cargo dependency; legacy plaintext accepted once | Rust unit test | Implemented; PASS |
| Display/Debug/log redaction | legacy `ApiKey` | `config/llm.rs` | Full `***REDACTED***`; provider list logs `hasKey` only | Rust unit test; static test | Implemented; PASS |
| Set/clear key, no old key re-display | legacy UI | `set_key`/`clear_key`; `TheAPIPanel.vue` | New-key input only; explicit clear; no provider key field | frontend typecheck blocked; component tests adapted | Implemented; typecheck BLOCKED |
| Config load failure refuses destructive save | legacy config | `config.rs` | `CONFIG_LOAD_FAILED`; save refuses; temp + backup | Rust tests (config round-trip) | Implemented; PASS (failure-path UI not exercised) |
| Legacy plaintext key migration | legacy store | `secret_store::unprotect` | Prefix-based decrypt; plaintext accepted and re-encrypted on next save | Rust test covers encrypted round-trip only | Implemented; plaintext migration NOT TESTED |
| Pause/resume/stop | legacy controller | `safety.js`; `utils/async.js`; `tasks.js`; `timeline.js`; `chapters.js` | Shared controller; every wait/checkpoint; stop observers/timers | safety test | Implemented; Node test PASS |
| Pause stops filling/submitting | legacy controller | quiz/interactive/questions | Checkpoint before each fill and before submit | safety test | Implemented; PASS |
| Stop prevents further writes | legacy controller | `safeRun` rethrows `AutomationStopped`; controller state | Stop state throws `TaskStopped`; course catches/records cancel | safety test | Implemented; PASS |
| Media waits are interruptible | legacy video/audio | `waitForTimeline`; `taskPointComplete`; `unlockedChapters` | Timers resolve/throw on STOPPED; pause keeps media paused | safety test | Implemented; static PASS |
| Close-window duplicate cleanup guard | legacy window.rs | `app/window.rs` | `CLOSING` AtomicBool + 2 s timeout | no GUI test | Implemented; GUI NOT TESTED |
| Remove focus/visibility spoofing | legacy security fix | `injected/chaoxing/focus.js` removed; `iframe-init.js` cleaned | Delete focus module and calls | static test | PASS |
| Remove background-throttling overrides | n/a | `lib.rs` | Removed disable-background/renderer flags; keep language flags | static test | PASS |
| Video/PDF continue legitimate playback/scroll | legacy | video/audio/pdf tasks | Kept; audio end-seek removed; no fake completion | Vitest blocked; source review | Implemented; browser script build PASS; runtime not executed |
| Exam automation blocked | none (new upstream feature) | `exam.js` | Formal exam pages only show manual panel; no `answerPage`/preview | adapted exam-entry test | Implemented; Vitest blocked |
| Work auto-fill requires fill authorization, never auto-submit | none (new upstream feature) | `work.js` | `resolveFillPolicy`; save draft only | adapted work tests | Implemented; Vitest blocked |
| No test deletion/relaxation | legacy tests | upstream `.js` tests; new security tests | Old deleted files not restored; assertions strengthened | git review | Implemented; reviewed |

## Security semantics that remain intentionally conservative

- Unknown task categories are never dispatched to a filling handler.
- An exam page is always treated as formal and never auto-filled.
- A quiz page with graded/exam wording is denied before solving.
- A page with "非计分/不计分/ungraded/practice" is the only path to fill/submit
  prompts; final human review remains mandatory.
- Partial AI answers are shown for review but **not filled/submitted**.
- Submit-failure and policy-denial paths show a manual panel; closing it stops
  the controller.

## Known gaps / not verified

- No real Windows GUI, OS-level pause/close, DPAPI prompt, CSP, or installer test.
- Frontend Vitest/Vite/typecheck/ESLint are blocked by local SAC/TS7 mismatch and
  missing upstream dev deps; this is not a CI PASS.
- Rust check/tests PASS used a process-level MSVC linker override because the
  default LLD toolchain is absent; the default build is not verified.
- Ubuntu CI was not triggered; all PASS labels above refer only to local
  executions.

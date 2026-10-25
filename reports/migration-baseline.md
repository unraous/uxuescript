# V0.2 Migration Baseline

- Date: 2026-10-25 (Asia/Shanghai)
- Original worktree: `<ORIGINAL_REPO>`
- Isolated worktree: `<MIGRATION_REPO>`
- Migration branch: `migrate/v02-security`
- Upstream: `https://github.com/unraous/uxuescript`

## Original baseline (read-only)

| Item | Value |
|---|---|
| Branch | `fix/security-v0.2` |
| HEAD | `4fada3777c319eadc5bbcbbab1dff81b6e5793b7` |
| Worktree | clean |
| Commit exists | yes (`git cat-file -t` = commit) |
| Cargo.lock SHA-256 | `c495a650860d06e3ffaa2f0ad9f6233b7cadf4f6edcf7b67c9a79b850806166c` |
| pnpm-lock.yaml SHA-256 | `7fbbde7e617ee6dd086aa74d33d1730a24c3105e8f277df5f40452af7c1128fa` |

The original worktree was only read. No reset, rebase, clean, branch/remote change,
push, PR update, or release action was performed against it.

## Upstream baseline used

| Item | Value |
|---|---|
| `upstream/main` SHA at start | `21420f28a4d3ea7d6a409f6090143172231fb5e0` |
| Version | 2.5.1 |
| Node version file | 24.21.0 |
| Merge base with legacy commit | `7e9ca27c8b78eb78666fea27d1cf825e49922f0d` |

The historical SHA in the task (`21420f28...`) was still the current upstream
`main` when cloned. It was verified with `git ls-remote` and the GitHub API.

## Directory and architecture differences

### Injected scripts

| Legacy (4fada377) | Upstream 2.5.1 / migration |
|---|---|
| `src-tauri/src/scripts/core.js` (monolith, ~1,300 lines) | `injected/chaoxing/course.js`, `course/runtime.js`, `course/chapter.js`, `course/chapter/tasks/*`, `questions/*` |
| policy/controller in `core.js` | new `injected/chaoxing/safety.js` (policy, submit assert, controller) |
| `src-tauri/src/scripts/iframe-init.js` (focus spoof) | `injected/chaoxing/iframe-init.js`; focus spoof removed |
| video/audio/PDF/quiz in `core.js` | `course/chapter/tasks/{video,audio,pdf,quiz,interactive}.js` |
| exam feature did not exist in this form | `injected/chaoxing/exam.js`, `exam/paged.js`; now blocked for formal exams |

### Rust AI dispatcher

| Legacy | Upstream |
|---|---|
| `src-tauri/src/core/quiz/llm/dispatcher.rs` monolith | `dispatcher.rs` + `answers.rs`, `chat.rs`, `responses.rs`, `gemini.rs`, `pool.rs` |
| old timeout/partial-result/error-body handling | new modules, now re-hardened: 60 s timeout, partial successes, no response bodies |

### Config, key, window

| Area | Legacy | Upstream 2.5.1 |
|---|---|---|
| API key | `secret_store.rs` DPAPI, `ProviderView`/`hasKey` | plaintext-ish `ApiKey` display/transparent serde, `providers()` returned full providers |
| Config | atomic save/refuse-overwrite changes | simple `fs::write`, load falls back silently |
| Window | close guard/timeout | new fullscreen module, close had no guard |

### Tests

- Legacy `.ts` script tests (`core-*.test.ts`, `tests/support/core.ts`).
- Upstream `.js` tests (`tests/scripts/core-*.test.js`, `tests/support/core.js`).
- Test semantics were migrated/adapted; old deleted files were not restored.
- New Node-native safety tests were added under `tests/security/`.

## Constraints honored at baseline

- No source modification in the original worktree.
- No protected files changed on the migration branch:
  - `.github/workflows/*`
  - `src-tauri/tauri.conf.json` (CSP/release config)
  - `Cargo.toml`, `Cargo.lock`
  - `package.json`, `pnpm-lock.yaml`
  - dependency versions/manifests
- No SAC/Defender changes.
- No real course, real API key, or real platform submission.

## Baseline status

| Item | Status |
|---|---|
| Original baseline read-only verification | PASS |
| Upstream current SHA verification | PASS |
| Isolated clone / branch creation | PASS |
| Upstream fetch | PASS |
| Original commit preserved | PASS |

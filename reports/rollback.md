# Rollback and Recovery

## Original worktree

- Path: `D:\Projects\xuexitong-ai-v0.2\source\uxuescript`
- Branch: `fix/security-v0.2`
- HEAD: `4fada3777c319eadc5bbcbbab1dff81b6e5793b7`
- The original worktree was not modified during migration. No rollback is
  required there.

## Isolated migration worktree

- Path: `C:\Users\李星宇\AppData\Local\Temp\uxuescript-v02-migration-20261025-221845\repo`
- Branch: `migrate/v02-security`
- Base: upstream `21420f28a4d3ea7d6a409f6090143172231fb5e0`
- No remote was pushed.

### Discard the migration candidate

If the candidate is rejected, remove only the isolated directory:

```powershell
Remove-Item -LiteralPath 'C:\Users\李星宇\AppData\Local\Temp\uxuescript-v02-migration-20261025-221845' -Recurse
```

Do not remove or reset the original worktree. Do not `git reset`/`rebase` the
original branch.

### Keep evidence but start over

The migration branch is local. If a clean comparison is needed, create a new
temporary clone of upstream `21420f28...` rather than rewriting the existing
clone. This round did not reset, rebase, or clean either worktree.

### Preserve the legacy commit

The original commit remains in the original repository and in the isolated
clone's `legacy` remote (`file:///D:/Projects/xuexitong-ai-v0.2/source/uxuescript`).
It is not deleted or rewritten.

## Remotes

- Original worktree remotes were not changed by this migration.
- Isolated clone: `origin` is upstream GitHub; `legacy` is the local V0.2
  repository. Neither was pushed to.
- PR #44 was not updated.

## Evidence

Reports are under `reports/` in the isolated clone:

- `migration-baseline.md`
- `security-mapping.md`
- `migration-report.md`
- `test-results.md`
- `diff-security-review.md`
- `release-readiness.md`
- `rollback.md` (this file)

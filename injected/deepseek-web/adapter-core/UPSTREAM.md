# Upstream runtime source

- Repository: `deepseek-web-adapter`
- Commit: `f4fdafef1f3a7589a04f4384732a3a63c83f762c`
- VERSION: `0.1.0`
- Scope: all 14 JavaScript runtime modules from that commit's `src/`, preserving their internal layout, filenames, relative imports, and runtime logic. `index.d.ts` is a host-consumed subset declaration, not the full SDK; runtime execution uses `index.js`.

Nine modules are byte-exact. Five carry only host tool annotations: `page.js` and `page/{attachments,composer,response}.js` each prepend one `no-restricted-imports` lint directive to retain the upstream relative module graph; `contracts.js` adds a boolean JSDoc cast at the already-validated option assignment because the host's `strictNullChecks: false` does not narrow that `unknown` value. Normalize by removing those four initial lint lines and replacing `/** @type {boolean} */ (option)` with `option` to recover per-file byte equality with the recorded commit. These annotations do not alter runtime behavior.

Updates are manual; there is no automatic synchronization. Select an explicit upstream commit, synchronize its runtime modules, verify per-file hashes after the documented annotation normalization and the static relative-import closure, then run the necessary script build, host type checks, and bridge tests. Keep host-owned files and annotations separate from upstream runtime changes.

At the recorded commit, `package.json` has no `license` field and the Git root has no LICENSE/COPYING file. Recheck licensing metadata and root files when updating; this record does not assign a license.

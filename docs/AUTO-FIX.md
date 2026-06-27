# Auto Fix Engine

Package Workbench can **safely apply certain fixes automatically** — and only those.
The whole engine is built around one promise: **never corrupt a file, and never
auto-apply anything risky.**

```
Issue:        Missing dependency: zod
Available Fix: Add dependency to package.json   [✅ safe]
Button:       Apply Fix

  --- packages/lineage/package.json
  +++ packages/lineage/package.json
  -   "dependencies": {}
  +   "dependencies": {
  +     "zod": "^3.22.4"
  +   }
```

## Safety taxonomy

Every candidate is classified, and the level decides what may happen to it:

| Level               | Examples                                                                                                                                                  | Behaviour                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **safe**            | add missing dependency (version resolved), add missing peer dep, remove unused dep, set `main`/`types`, add `version`                                     | **auto-applies**                                                |
| **review_required** | add an `exports` map, rewrite an exports map, dependency upgrades, duplicate-version resolution, path-alias fixes, remove a stale re-export (source edit) | shows the diff; applied **only with explicit confirmation**     |
| **dangerous**       | architecture refactors, package splits, code rewrites, API changes                                                                                        | **never applied** — only suggested (see the Refactor Architect) |

Anything the engine isn't certain about degrades downward — e.g. an `add missing
dependency` whose version can't be resolved from `node_modules` becomes
`review_required`, not `safe`.

## Supported fixes

**Dependency** — add missing dependency, add missing peer dependency, remove unused
dependency. **Package.json** — set a missing `main`/`types` to an existing artifact,
add a missing `exports` map (review). **Imports** — remove a stale re-export (review).
**Metadata** — add a missing `version`. Malformed `package.json` is **never edited**.

## The patch engine (why files are never corrupted)

Every change goes through one engine with four guarantees:

1. **Pre-flight conflict check.** Each patch declares the exact content it expects on
   disk. If the file has changed since the fix was computed, the whole group is
   **aborted untouched**.
2. **Backups first.** Originals are copied into a backup manifest _before_ any write,
   so a rollback is always possible — even after a crash.
3. **Atomic writes.** Each file is written to a temp sibling and then `rename`d over
   the target. A reader never sees a half-written file.
4. **All-or-nothing + recovery.** If any write in a group fails, the already-written
   files are **restored from backup** and the group reports failure.

```
preflight ─▶ write backups ─▶ atomic write each file
   │              │                    │ fail?
   abort          (manifest)           ▼
 (no change)                    restore applied → report failure
```

These four properties are the ones the test suite hammers directly: patch
generation, atomic writes, rollback, and **failed-patch recovery** (a mid-group
failure leaving the first file exactly as it was).

## Rollback

- **Undo last fix** — `undoLast()` rolls back the most recent group.
- **Rollback a session / restore a backup** — `rollback(backupDir, id)` by id.
- Backups live under `<workspace>/.package-workbench/fix-backups/<id>/` with a
  `manifest.json`; rollback is **idempotent**.

## CLI

```bash
# Preview (default): show every candidate + its diff, change nothing
package-workbench fix .

# Apply the SAFE fixes (atomic, with backups)
package-workbench fix . --apply

# Also apply review-required fixes (still never dangerous)
package-workbench fix . --apply --review

# Roll back the last applied group
package-workbench fix . --undo

# Machine-readable
package-workbench fix . --format json
```

`fix` (preview) exits non-zero when safe fixes are available, so CI can flag them.

### Example workflow

```
$ package-workbench fix .
Auto Fix — 2 safe · 1 review · 0 suggest-only

✅ safe   Add dependency to package.json
   Issue: Missing dependency: zod
   Fix:   Add "zod": "^3.22.4" to dependencies
   · Resolved installed version ^3.22.4

✅ safe   Add missing "version" field
   Issue: package.json has no "version"
   Fix:   Set "version": "0.0.0"

⚠️ review  Add an "exports" map
   ...

$ package-workbench fix . --apply
Applied 2 fix(es) (session fix-2026-06-27T…).
  ✓ add_dep:@nw/lineage:zod
  ✓ add_version:@nw/lineage
Undo with:  package-workbench fix . --undo
```

## Desktop

The **Fixes** tab shows each candidate as **Issue → Fix → Diff → Apply**, grouped by
safety with a colour-coded badge. Safe and review fixes get an **Apply Fix** button
(review shows the diff first); dangerous ones are suggest-only. **Undo last fix**
rolls back the most recent change. Application runs through the same atomic engine in
the main process.

## Safety guarantees (summary)

- **Safe by default** — only `safe` fixes auto-apply; `dangerous` never do.
- **Atomic** — temp-file + rename; no partial writes.
- **Never corrupts** — pre-flight conflict detection + backups + recovery.
- **Reversible** — every applied group has a backup; undo is one call.
- **Cross-platform** — same-directory temp + rename, forward-slash safe, no symlinks.
- **Conservative** — malformed manifests are never touched; uncertain fixes are
  downgraded to review, not applied.

## Unsupported (by design)

- **Code-level refactors / API changes / package splits** — surfaced by the Refactor
  Architect as proposals; never auto-applied.
- **Broken relative-import rewrites** beyond a unique, unambiguous target — these need
  human judgement and are left as review items without an auto-patch.
- **Lockfile edits / installs** — Auto Fix edits manifests and source; it never runs a
  package manager. Run your installer after applying dependency fixes.
- **Multi-file structural moves** — out of scope for a "safe, reversible" engine.

```

```

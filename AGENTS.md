# Good Branch Manager — agent guide

VS Code extension that adds a **Branches - GBM** tree to the Source Control sidebar: branch list, sync status icons, expandable commit history, GitHub PR integration, and branch actions.

## Commands

```sh
just build          # compile TypeScript → out/
just test-unit      # fast unit tests (preferred during development)
just test           # unit + VS Code integration tests
just package        # build .vsix
```

Integration tests need a display or `just test-integration-xvfb` on headless Linux.

## Source layout

| File | Role |
|------|------|
| `src/extension.ts` | Activation, commands, config change handlers |
| `src/tree.ts` | `BranchTreeProvider` — tree structure, tooltips, icons |
| `src/branchUi.ts` | Pure UI helpers: sync status, merge display, descriptions, icon resolution |
| `src/git.ts` | Git CLI wrapper, `Branch` / `RepoInfo` types, commit details |
| `src/github.ts` | Remote URL parsing, GitHub API (PR list), auth |
| `src/commitView.ts` | Opens native Git diff or fallback commit panel |
| `media/light/`, `media/dark/` | Colored SVG icons (not themed codicons) |

Tests live in `src/test/unit/` (Mocha, TDD `suite`/`test`) and `src/test/suite/` (integration). Helpers: `src/test/helpers/gitRepo.ts`.

## Branch row rendering pipeline

1. `Git.getBranches()` loads local/remote refs, upstream tracking, and `merged` via `git for-each-ref --merged <default>`.
2. `branchUi.ts` computes display state (sync, stale, merged, PR hints).
3. `tree.ts` `branchItem()` assembles description, icon, tooltip, and context menu `contextValue`.

Keep display logic in `branchUi.ts` (unit-testable). `tree.ts` should stay thin.

## Merge status (regression-sensitive)

Two sources of “merged”:

1. **Git** — `branch.merged` from `--merged`. Cleared in `git.ts` when a branch shares the default tip (fresh branch created from `main`, not truly merged).
2. **GitHub PR** — `pr.mergedAt` / `pr.mergedBy`. Authoritative even when the branch is at the default tip.

Use `isBranchMergedDisplay()` for any merged UI (description hint, icon, tooltip). Do **not** read `branch.merged` directly in `tree.ts`.

| Case | Show merged? | Icon |
|------|--------------|------|
| Fresh branch at default tip | No | Sync icon |
| Git-merged, old tip still checked out | Yes | `git-merge-purple` |
| PR merged (any tip) | Yes | `git-merge-purple` |
| Current checkout | No merge icon | `check-green` (even if PR merged) |

Tooltip merge line: `buildMergeStatusTooltip()` — PR path includes who/when; git-only path says “Already merged into {default}.”

Icon file: `resolveBranchIconFile()` — PR icons take precedence over sync icons.

Tests: `src/test/unit/branchUi.test.ts` suite **branch merge display**; `src/test/unit/git.test.ts` integration cases for fresh vs truly merged branches.

## Other conventions

- **Icons**: filenames like `git-merge-purple`, resolved per theme in `tree.ts` `icon()`.
- **Config keys** (`goodBranchManager.*`): declared in `package.json` — keep code fallbacks aligned with defaults there.
- **Trusted markdown tooltips**: escape user/git strings with `escapeMarkdown()` before interpolating.
- **Commit expansion**: `resolveBranchBaseRef()` + `getBranchCommits(ref, limit, base)` list branch-only commits unless `showBaseBranchCommits` is true.
- **Scope**: minimal diffs; match existing style; no drive-by refactors.

## Packaging

Version in `package.json`. Release workflow attaches `.vsix` to GitHub Releases. Do not commit secrets or large binaries.

import assert from 'assert';
import {
  branchSharesDefaultTip,
  branchSyncStatus,
  buildBranchContextValue,
  buildBranchDescription,
  buildMergeStatusTooltip,
  escapeMarkdown,
  formatMergedAt,
  isBranchMergedDisplay,
  isBranchStale,
  resolveBranchBaseRef,
  resolveBranchIconFile,
  splitRemoteBranch
} from '../../branchUi';
import { sampleBranch } from '../helpers/gitRepo';

function samplePr(overrides: Partial<import('../../github').PullRequest> = {}): import('../../github').PullRequest {
  return {
    number: 7,
    title: 'Feature',
    state: 'closed',
    mergedAt: null,
    mergedBy: null,
    htmlUrl: 'https://github.com/example/pr/7',
    headRef: 'feature/x',
    ...overrides
  };
}

suite('branchUi helpers', () => {
  test('splitRemoteBranch handles remote prefixes', () => {
    assert.deepStrictEqual(splitRemoteBranch('origin/feature/x'), {
      remote: 'origin',
      branch: 'feature/x'
    });
    assert.deepStrictEqual(splitRemoteBranch('main'), {
      remote: 'origin',
      branch: 'main'
    });
  });

  test('escapeMarkdown escapes special characters', () => {
    assert.strictEqual(escapeMarkdown('feat_*bold*'), 'feat\\_\\*bold\\*');
  });

  test('branchSyncStatus describes common sync states', () => {
    assert.strictEqual(branchSyncStatus(sampleBranch({ isRemote: true })).iconFile, 'cloud-neutral');
    assert.strictEqual(branchSyncStatus(sampleBranch({ isCurrent: true })).text, 'synced');
    assert.strictEqual(branchSyncStatus(sampleBranch({ upstream: undefined })).text, 'local only');
    assert.strictEqual(branchSyncStatus(sampleBranch({ upstreamGone: true })).text, 'upstream gone');
    assert.strictEqual(
      branchSyncStatus(sampleBranch({ ahead: 2, behind: 1 })).text,
      '2↑ 1↓'
    );
    assert.strictEqual(
      branchSyncStatus(sampleBranch({ ahead: 2, behind: 1 })).iconFile,
      'arrow-up-dark-red'
    );
    assert.strictEqual(
      branchSyncStatus(sampleBranch({ ahead: 0, behind: 1 })).iconFile,
      'arrow-down-dark-red'
    );
  });

  test('isBranchStale respects threshold and current branch', () => {
    const now = Date.now();
    const old = sampleBranch({ committerDateUnix: Math.floor(now / 1000) - 20 * 86400 });
    assert.strictEqual(isBranchStale(old, 10, now), true);
    assert.strictEqual(isBranchStale(old, 0, now), false);
    assert.strictEqual(isBranchStale({ ...old, isCurrent: true }, 10, now), false);
  });

  test('buildBranchContextValue encodes menu when-clauses', () => {
    assert.strictEqual(
      buildBranchContextValue(sampleBranch({ isCurrent: true }), 'main', false),
      'branch-local-upstream-current'
    );
    assert.strictEqual(
      buildBranchContextValue(sampleBranch({ name: 'main', upstream: undefined }), 'main', true),
      'branch-local-default-has-pr'
    );
  });

  test('resolveBranchBaseRef targets the default branch', () => {
    assert.strictEqual(
      resolveBranchBaseRef(sampleBranch({ name: 'feature/x' }), 'main'),
      'main'
    );
    assert.strictEqual(
      resolveBranchBaseRef(sampleBranch({ name: 'main', upstream: undefined }), 'main'),
      undefined
    );
    assert.strictEqual(
      resolveBranchBaseRef(
        sampleBranch({ name: 'origin/feature/x', shortName: 'feature/x', isRemote: true, remote: 'origin' }),
        'main'
      ),
      'origin/main'
    );
    assert.strictEqual(
      resolveBranchBaseRef(
        sampleBranch({ name: 'origin/main', shortName: 'main', isRemote: true, remote: 'origin' }),
        'main'
      ),
      undefined
    );
  });

  test('branchSharesDefaultTip detects fresh branches', () => {
    const main = sampleBranch({
      name: 'main',
      fullSha: 'sha-main',
      sha: 'sha-mai',
      upstream: undefined
    });
    const feature = sampleBranch({
      name: 'feature/new',
      fullSha: 'sha-main',
      sha: 'sha-mai'
    });
    const diverged = sampleBranch({
      name: 'feature/old',
      fullSha: 'sha-other',
      sha: 'sha-oth'
    });
    assert.strictEqual(branchSharesDefaultTip(feature, 'main', [main, feature]), true);
    assert.strictEqual(branchSharesDefaultTip(diverged, 'main', [main, diverged]), false);
    assert.strictEqual(branchSharesDefaultTip(main, 'main', [main]), false);
  });

  test('buildBranchDescription skips merged hint for fresh branches', () => {
    const main = sampleBranch({
      name: 'main',
      fullSha: 'sha-main',
      sha: 'sha-mai',
      upstream: undefined,
      committerDateRelative: '1 hour ago'
    });
    const fresh = sampleBranch({
      name: 'screenshots',
      fullSha: 'sha-main',
      sha: 'sha-mai',
      upstream: undefined,
      merged: true,
      committerDateRelative: '1 hour ago'
    });
    const description = buildBranchDescription(fresh, {
      defaultBranch: 'main',
      staleAfterDays: 10,
      localBranches: [main, fresh]
    });
    assert.doesNotMatch(description, /merged/);
  });

  test('buildBranchDescription joins status hints', () => {
    const description = buildBranchDescription(
      sampleBranch({ ahead: 1, committerDateRelative: '2 days ago' }),
      {
        defaultBranch: 'main',
        staleAfterDays: 10,
        pr: {
          number: 42,
          title: 'Add tests',
          state: 'open',
          mergedAt: null,
          mergedBy: null,
          htmlUrl: 'https://github.com/example/pr/42',
          headRef: 'feature/test'
        }
      }
    );
    assert.match(description, /1↑/);
    assert.match(description, /PR #42/);
    assert.match(description, /2 days ago/);
  });

  test('isBranchMergedDisplay uses PR merge data even at the default tip', () => {
    const main = sampleBranch({
      name: 'main',
      fullSha: 'sha-main',
      sha: 'sha-mai',
      upstream: undefined
    });
    const feature = sampleBranch({
      name: 'feature/x',
      fullSha: 'sha-main',
      sha: 'sha-mai',
      merged: false
    });
    assert.strictEqual(
      isBranchMergedDisplay(feature, {
        defaultBranch: 'main',
        localBranches: [main, feature],
        pr: {
          number: 7,
          title: 'Feature',
          state: 'closed',
          mergedAt: '2026-06-01T12:00:00Z',
          mergedBy: 'octocat',
          htmlUrl: 'https://github.com/example/pr/7',
          headRef: 'feature/x'
        }
      }),
      true
    );
  });

  test('isBranchMergedDisplay ignores fresh branches at the default tip', () => {
    const main = sampleBranch({
      name: 'main',
      fullSha: 'sha-main',
      sha: 'sha-mai',
      upstream: undefined
    });
    const fresh = sampleBranch({
      name: 'screenshots',
      fullSha: 'sha-main',
      sha: 'sha-mai',
      merged: false
    });
    assert.strictEqual(
      isBranchMergedDisplay(fresh, { defaultBranch: 'main', localBranches: [main, fresh] }),
      false
    );
  });

  test('buildMergeStatusTooltip includes who merged and when', () => {
    const line = buildMergeStatusTooltip('main', {
      pr: {
        number: 7,
        title: 'Feature',
        state: 'closed',
        mergedAt: '2026-06-01T12:00:00Z',
        mergedBy: 'octocat',
        htmlUrl: 'https://github.com/example/pr/7',
        headRef: 'feature/x'
      }
    });
    assert.ok(line);
    assert.match(line!, /Merged into main/);
    assert.match(line!, /octocat/);
  });
});

suite('branch merge display', () => {
  const main = sampleBranch({
    name: 'main',
    fullSha: 'sha-main',
    sha: 'sha-mai',
    upstream: undefined
  });

  test('resolveBranchIconFile uses merge icon for git-detected merges', () => {
    const merged = sampleBranch({
      name: 'feature/done',
      fullSha: 'sha-old',
      sha: 'sha-old',
      merged: true
    });
    assert.strictEqual(
      resolveBranchIconFile(merged, { defaultBranch: 'main', localBranches: [main, merged] }),
      'git-merge-purple'
    );
  });

  test('resolveBranchIconFile uses merge icon for PR merges at the default tip', () => {
    const atTip = sampleBranch({
      name: 'feature/x',
      fullSha: 'sha-main',
      sha: 'sha-mai',
      merged: false
    });
    assert.strictEqual(
      resolveBranchIconFile(atTip, {
        defaultBranch: 'main',
        localBranches: [main, atTip],
        pr: samplePr({ mergedAt: '2026-06-01T12:00:00Z', mergedBy: 'octocat' })
      }),
      'git-merge-purple'
    );
  });

  test('resolveBranchIconFile keeps sync icon for fresh branches at the default tip', () => {
    const fresh = sampleBranch({
      name: 'screenshots',
      fullSha: 'sha-main',
      sha: 'sha-mai',
      merged: false
    });
    assert.strictEqual(
      resolveBranchIconFile(fresh, { defaultBranch: 'main', localBranches: [main, fresh] }),
      'cloud-blue'
    );
  });

  test('resolveBranchIconFile prefers open PR icon over git merge state', () => {
    const branch = sampleBranch({ merged: true });
    assert.strictEqual(
      resolveBranchIconFile(branch, {
        defaultBranch: 'main',
        localBranches: [main, branch],
        pr: samplePr({ state: 'open', mergedAt: null })
      }),
      'git-pull-request-green'
    );
  });

  test('resolveBranchIconFile uses closed PR icon when PR was not merged', () => {
    const branch = sampleBranch();
    assert.strictEqual(
      resolveBranchIconFile(branch, {
        defaultBranch: 'main',
        pr: samplePr({ state: 'closed', mergedAt: null })
      }),
      'git-pull-request-closed-red'
    );
  });

  test('resolveBranchIconFile uses current-branch icon even when PR is merged', () => {
    const current = sampleBranch({ isCurrent: true });
    assert.strictEqual(
      resolveBranchIconFile(current, {
        defaultBranch: 'main',
        pr: samplePr({ mergedAt: '2026-06-01T12:00:00Z' })
      }),
      'check-green'
    );
  });

  test('isBranchMergedDisplay detects git merges that are not at the default tip', () => {
    const merged = sampleBranch({
      name: 'feature/done',
      fullSha: 'sha-old',
      merged: true
    });
    assert.strictEqual(
      isBranchMergedDisplay(merged, { defaultBranch: 'main', localBranches: [main, merged] }),
      true
    );
  });

  test('buildBranchDescription shows merged hint for git-detected merges', () => {
    const merged = sampleBranch({
      name: 'feature/done',
      fullSha: 'sha-old',
      merged: true,
      committerDateRelative: '3 days ago'
    });
    const description = buildBranchDescription(merged, {
      defaultBranch: 'main',
      staleAfterDays: 10,
      localBranches: [main, merged]
    });
    assert.match(description, /merged/);
  });

  test('buildBranchDescription shows merged hint for PR merges at the default tip', () => {
    const atTip = sampleBranch({
      name: 'feature/x',
      fullSha: 'sha-main',
      sha: 'sha-mai',
      merged: false,
      committerDateRelative: '1 day ago'
    });
    const description = buildBranchDescription(atTip, {
      defaultBranch: 'main',
      staleAfterDays: 10,
      localBranches: [main, atTip],
      pr: samplePr({ mergedAt: '2026-06-01T12:00:00Z', mergedBy: 'octocat' })
    });
    assert.match(description, /merged/);
    assert.match(description, /PR #7 \(merged\)/);
  });

  test('buildMergeStatusTooltip falls back to git-only message without PR data', () => {
    assert.strictEqual(buildMergeStatusTooltip('main', { gitMerged: true }), 'Already merged into main.');
  });

  test('buildMergeStatusTooltip uses Unknown when mergedBy is missing', () => {
    const line = buildMergeStatusTooltip('main', {
      pr: samplePr({ mergedAt: '2026-06-01T12:00:00Z', mergedBy: null })
    });
    assert.match(line!, /Unknown/);
  });

  test('formatMergedAt returns the original string for invalid dates', () => {
    assert.strictEqual(formatMergedAt('not-a-date'), 'not-a-date');
  });
});

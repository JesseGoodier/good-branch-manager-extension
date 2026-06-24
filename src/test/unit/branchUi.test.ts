import assert from 'assert';
import {
  branchSharesDefaultTip,
  branchSyncStatus,
  buildBranchContextValue,
  buildBranchDescription,
  escapeMarkdown,
  isBranchStale,
  resolveBranchBaseRef,
  splitRemoteBranch
} from '../../branchUi';
import { sampleBranch } from '../helpers/gitRepo';

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
          htmlUrl: 'https://github.com/example/pr/42',
          headRef: 'feature/test'
        }
      }
    );
    assert.match(description, /1↑/);
    assert.match(description, /PR #42/);
    assert.match(description, /2 days ago/);
  });
});

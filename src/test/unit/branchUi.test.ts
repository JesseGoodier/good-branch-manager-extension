import assert from 'assert';
import {
  branchSyncStatus,
  buildBranchContextValue,
  buildBranchDescription,
  escapeMarkdown,
  isBranchStale,
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

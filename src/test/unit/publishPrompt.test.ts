import assert from 'assert';
import {
  getBranchRemote,
  publishPromptKey,
  shouldPromptForPublishedBranch,
  snapshotBranches
} from '../../publishPrompt';
import { sampleBranch } from '../helpers/gitRepo';

suite('publish prompt helpers', () => {
  test('snapshotBranches tracks upstream state', () => {
    const snapshot = snapshotBranches([
      sampleBranch({ name: 'feature/a', upstream: undefined }),
      sampleBranch({ name: 'feature/b', upstream: 'origin/feature/b' })
    ]);
    assert.strictEqual(snapshot.get('feature/a')?.upstream, undefined);
    assert.strictEqual(snapshot.get('feature/b')?.upstream, 'origin/feature/b');
  });

  test('publishPromptKey is stable', () => {
    assert.strictEqual(
      publishPromptKey('/repo', 'feature/a', 'origin/feature/a'),
      '/repo:feature/a:origin/feature/a'
    );
  });

  test('getBranchRemote prefers upstream remote', () => {
    assert.strictEqual(getBranchRemote(sampleBranch({ upstream: 'upstream/feature' })), 'upstream');
    assert.strictEqual(getBranchRemote(sampleBranch({ upstream: undefined, remote: 'origin' })), 'origin');
  });

  test('shouldPromptForPublishedBranch detects first publish transitions', () => {
    const previous = snapshotBranches([
      sampleBranch({ name: 'feature/a', upstream: undefined, isCurrent: true })
    ]);
    const branch = sampleBranch({
      name: 'feature/a',
      upstream: 'origin/feature/a',
      isCurrent: true
    });

    assert.strictEqual(
      shouldPromptForPublishedBranch({
        enabled: true,
        previousSnapshot: previous,
        branch,
        defaultBranch: 'main',
        hasExistingPr: false,
        suppressed: false,
        alreadyPrompted: false
      }),
      true
    );

    assert.strictEqual(
      shouldPromptForPublishedBranch({
        enabled: false,
        previousSnapshot: previous,
        branch,
        defaultBranch: 'main',
        hasExistingPr: false,
        suppressed: false,
        alreadyPrompted: false
      }),
      false
    );

    assert.strictEqual(
      shouldPromptForPublishedBranch({
        enabled: true,
        previousSnapshot: previous,
        branch: { ...branch, name: 'main' },
        defaultBranch: 'main',
        hasExistingPr: false,
        suppressed: false,
        alreadyPrompted: false
      }),
      false
    );
  });
});

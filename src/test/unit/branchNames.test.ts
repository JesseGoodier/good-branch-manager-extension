import assert from 'assert';
import { validateBranchName } from '../../branchNames';

suite('validateBranchName', () => {
  test('accepts common branch names', () => {
    assert.strictEqual(validateBranchName('main'), undefined);
    assert.strictEqual(validateBranchName('feature/my-change'), undefined);
    assert.strictEqual(validateBranchName('release-1.2.3'), undefined);
  });

  test('rejects empty and invalid names', () => {
    assert.strictEqual(validateBranchName(''), 'Branch name is required.');
    assert.strictEqual(validateBranchName('   '), 'Branch name is required.');
    assert.strictEqual(validateBranchName('bad..name'), 'Not a valid git branch name.');
    assert.strictEqual(validateBranchName('bad name'), 'Not a valid git branch name.');
    assert.strictEqual(validateBranchName('.lock'), 'Not a valid git branch name.');
  });
});

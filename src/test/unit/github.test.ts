import assert from 'assert';
import { RemoteRepo } from '../../git';
import { branchUrl, commitUrl, githubApiBase, isGitHubAuthError } from '../../github';

function repo(provider: RemoteRepo['provider'], overrides: Partial<RemoteRepo> = {}): RemoteRepo {
  return {
    host: 'github.com',
    owner: 'octocat',
    repo: 'Hello-World',
    provider,
    ...overrides
  };
}

suite('isGitHubAuthError', () => {
  test('detects common GitHub authentication failures', () => {
    assert.strictEqual(isGitHubAuthError(401, 'Bad credentials'), true);
    assert.strictEqual(isGitHubAuthError(403, 'Bad credentials'), true);
    assert.strictEqual(isGitHubAuthError(401, 'Requires authentication'), true);
    assert.strictEqual(isGitHubAuthError(422, 'Validation Failed'), false);
  });
});

suite('githubApiBase', () => {
  test('routes GitHub.com and enterprise API hosts', () => {
    assert.strictEqual(githubApiBase(repo('github')), 'https://api.github.com');
    assert.strictEqual(
      githubApiBase(repo('github', { host: 'ghe.github.com' })),
      'https://api.ghe.github.com'
    );
    assert.strictEqual(
      githubApiBase(repo('github', { host: 'github.mycompany.com' })),
      'https://github.mycompany.com/api/v3'
    );
  });
});

suite('branchUrl', () => {
  test('builds provider-specific branch URLs', () => {
    assert.strictEqual(
      branchUrl(repo('github'), 'feature/x'),
      'https://github.com/octocat/Hello-World/tree/feature/x'
    );
    assert.strictEqual(
      branchUrl(repo('gitlab', { host: 'gitlab.com', owner: 'group/sub', repo: 'app' }), 'main'),
      'https://gitlab.com/group/sub/app/-/tree/main'
    );
    assert.strictEqual(
      branchUrl(repo('bitbucket', { host: 'bitbucket.org', owner: 'workspace', repo: 'repo' }), 'main'),
      'https://bitbucket.org/workspace/repo/src/main'
    );
    assert.strictEqual(
      branchUrl(repo('azure', { host: 'dev.azure.com', owner: 'org/project', repo: 'repo' }), 'main'),
      'https://dev.azure.com/org/project/_git/repo?version=GBmain'
    );
    assert.strictEqual(
      branchUrl(repo('generic', { host: 'git.example.com', owner: 'team', repo: 'app' }), 'dev'),
      'https://git.example.com/team/app/src/branch/dev'
    );
  });
});

suite('commitUrl', () => {
  test('builds provider-specific commit URLs', () => {
    const sha = 'abc123def456';
    assert.strictEqual(
      commitUrl(repo('github'), sha),
      'https://github.com/octocat/Hello-World/commit/abc123def456'
    );
    assert.strictEqual(
      commitUrl(repo('gitlab', { host: 'gitlab.com', owner: 'group', repo: 'app' }), sha),
      'https://gitlab.com/group/app/-/commit/abc123def456'
    );
    assert.strictEqual(
      commitUrl(repo('bitbucket', { host: 'bitbucket.org', owner: 'workspace', repo: 'repo' }), sha),
      'https://bitbucket.org/workspace/repo/commits/abc123def456'
    );
    assert.strictEqual(
      commitUrl(repo('azure', { host: 'dev.azure.com', owner: 'org/project', repo: 'repo' }), sha),
      'https://dev.azure.com/org/project/_git/repo/commit/abc123def456'
    );
  });
});

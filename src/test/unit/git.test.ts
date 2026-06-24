import assert from 'assert';
import { Git, GitError, isGitHubHost } from '../../git';
import { createTestRepo, runGit } from '../helpers/gitRepo';

suite('Git.parseRemoteUrl', () => {
  test('parses GitHub HTTPS remotes', () => {
    const repo = Git.parseRemoteUrl('https://github.com/octocat/Hello-World.git');
    assert.deepStrictEqual(repo, {
      host: 'github.com',
      owner: 'octocat',
      repo: 'Hello-World',
      provider: 'github'
    });
  });

  test('parses GitHub SSH remotes', () => {
    const repo = Git.parseRemoteUrl('git@github.com:octocat/Hello-World.git');
    assert.strictEqual(repo?.provider, 'github');
    assert.strictEqual(repo?.owner, 'octocat');
    assert.strictEqual(repo?.repo, 'Hello-World');
  });

  test('parses GitHub Enterprise hosts', () => {
    const repo = Git.parseRemoteUrl('https://github.mycompany.com/team/app.git');
    assert.strictEqual(repo?.provider, 'github');
    assert.strictEqual(repo?.host, 'github.mycompany.com');
  });

  test('parses GitLab remotes', () => {
    const repo = Git.parseRemoteUrl('https://gitlab.com/group/subgroup/project.git');
    assert.strictEqual(repo?.provider, 'gitlab');
    assert.strictEqual(repo?.owner, 'group/subgroup');
    assert.strictEqual(repo?.repo, 'project');
  });

  test('parses Bitbucket remotes', () => {
    const repo = Git.parseRemoteUrl('https://bitbucket.org/workspace/repo.git');
    assert.strictEqual(repo?.provider, 'bitbucket');
  });

  test('parses Azure DevOps HTTPS remotes', () => {
    const repo = Git.parseRemoteUrl('https://dev.azure.com/org/project/_git/repo');
    assert.strictEqual(repo?.provider, 'azure');
    assert.strictEqual(repo?.owner, 'org/project');
    assert.strictEqual(repo?.repo, 'repo');
  });

  test('parses Azure DevOps SSH remotes', () => {
    const repo = Git.parseRemoteUrl('ssh.dev.azure.com:v3/org/project/repo');
    assert.strictEqual(repo?.provider, 'azure');
    assert.strictEqual(repo?.owner, 'org/project');
    assert.strictEqual(repo?.repo, 'repo');
  });

  test('returns undefined for unrecognised remotes', () => {
    assert.strictEqual(Git.parseRemoteUrl('/local/path'), undefined);
    assert.strictEqual(Git.parseRemoteUrl('not-a-remote'), undefined);
  });
});

suite('Git.parseGitHubRemote', () => {
  test('returns owner/repo for GitHub remotes only', () => {
    assert.deepStrictEqual(Git.parseGitHubRemote('git@github.com:octocat/Hello-World.git'), {
      owner: 'octocat',
      repo: 'Hello-World'
    });
    assert.strictEqual(Git.parseGitHubRemote('https://gitlab.com/group/repo.git'), undefined);
  });
});

suite('isGitHubHost', () => {
  test('detects github.com and enterprise hosts', () => {
    assert.strictEqual(isGitHubHost('github.com'), true);
    assert.strictEqual(isGitHubHost('api.github.com'), true);
    assert.strictEqual(isGitHubHost('github.mycompany.com'), true);
    assert.strictEqual(isGitHubHost('gitlab.com'), false);
  });
});

suite('Git repository integration', () => {
  let repo: ReturnType<typeof createTestRepo>;

  suiteSetup(() => {
    repo = createTestRepo();
    runGit(repo.root, ['branch', '-M', 'main']);
    runGit(repo.root, ['branch', 'feature/a']);
    runGit(repo.root, ['switch', 'main']);
  });

  suiteTeardown(() => {
    repo.cleanup();
  });

  test('lists local branches with current branch marked', async () => {
    const git = new Git(repo.root);
    const info = await git.getBranches();
    assert.ok(info.local.some((branch) => branch.name === 'main' && branch.isCurrent));
    assert.ok(info.local.some((branch) => branch.name === 'feature/a' && !branch.isCurrent));
    assert.strictEqual(info.defaultBranch, 'main');
  });

  test('does not mark fresh branches at the default tip as merged', async () => {
    const git = new Git(repo.root);
    runGit(repo.root, ['switch', '-c', 'screenshots']);
    const info = await git.getBranches();
    const screenshots = info.local.find((branch) => branch.name === 'screenshots');
    const main = info.local.find((branch) => branch.name === 'main');
    assert.ok(screenshots);
    assert.ok(main);
    assert.strictEqual(screenshots!.fullSha, main!.fullSha);
    assert.strictEqual(screenshots!.merged, false);
  });

  test('reads commit subjects and branch history', async () => {
    const git = new Git(repo.root);
    const subject = await git.getLastCommitSubject('main');
    assert.strictEqual(subject, 'initial');
    const commits = await git.getBranchCommits('main', 5);
    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].subject, 'initial');
  });

  test('lists only branch-only commits when a base ref is provided', async () => {
    const git = new Git(repo.root);
    runGit(repo.root, ['switch', '-c', 'feature/b']);
    runGit(repo.root, ['commit', '--allow-empty', '-m', 'feature-only']);
    const branchOnly = await git.getBranchCommits('feature/b', 10, 'main');
    assert.strictEqual(branchOnly.length, 1);
    assert.strictEqual(branchOnly[0].subject, 'feature-only');
    const full = await git.getBranchCommits('feature/b', 10);
    assert.strictEqual(full.length, 2);
  });

  test('loads commit details and patch', async () => {
    const git = new Git(repo.root);
    const info = await git.getBranches();
    const main = info.local.find((branch) => branch.name === 'main');
    assert.ok(main);
    const details = await git.getCommitDetails(main!.fullSha);
    assert.ok(details);
    assert.strictEqual(details!.subject, 'initial');
    assert.strictEqual(details!.authorName, 'Test User');
    assert.strictEqual(typeof details!.patch, 'string');
  });

  test('surfaces git errors with stderr', async () => {
    const git = new Git(repo.root);
    await assert.rejects(
      () => git.exec(['checkout', 'does-not-exist']),
      (err: GitError) => err instanceof GitError && /pathspec/i.test(err.stderr)
    );
  });
});

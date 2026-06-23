import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface TestRepo {
  root: string;
  cleanup: () => void;
}

export function createTestRepo(): TestRepo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbm-test-repo-'));
  runGit(root, ['init']);
  runGit(root, ['config', 'user.email', 'test@example.com']);
  runGit(root, ['config', 'user.name', 'Test User']);
  runGit(root, ['commit', '--allow-empty', '-m', 'initial']);
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  };
}

export function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();
}

export function sampleBranch(overrides: Partial<import('../../git').Branch> = {}): import('../../git').Branch {
  return {
    name: 'feature/test',
    shortName: 'feature/test',
    isRemote: false,
    upstream: 'origin/feature/test',
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    isCurrent: false,
    committerDateUnix: Math.floor(Date.now() / 1000) - 86400,
    committerDateRelative: '1 day ago',
    sha: 'abc1234',
    fullSha: 'abc1234567890abcdef1234567890abcdef1234',
    authorName: 'Test User',
    merged: false,
    ...overrides
  };
}

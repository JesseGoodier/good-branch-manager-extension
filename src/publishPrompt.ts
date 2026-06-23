import { Branch } from './git';

export interface BranchSnapshot {
  upstream?: string;
  upstreamGone: boolean;
}

export function snapshotBranches(branches: Branch[]): Map<string, BranchSnapshot> {
  return new Map(
    branches.map((branch) => [
      branch.name,
      {
        upstream: branch.upstream,
        upstreamGone: branch.upstreamGone
      }
    ])
  );
}

export function publishPromptKey(repoRoot: string, branchName: string, upstream: string): string {
  return `${repoRoot}:${branchName}:${upstream}`;
}

export function getBranchRemote(branch: Branch): string {
  if (branch.upstream) {
    return branch.upstream.split('/')[0];
  }
  return branch.remote ?? 'origin';
}

export function shouldPromptForPublishedBranch(opts: {
  enabled: boolean;
  previousSnapshot: Map<string, BranchSnapshot> | undefined;
  branch: Branch | undefined;
  defaultBranch: string;
  hasExistingPr: boolean;
  suppressed: boolean;
  alreadyPrompted: boolean;
}): boolean {
  if (!opts.enabled || !opts.previousSnapshot || !opts.branch) {
    return false;
  }
  if (opts.branch.name === opts.defaultBranch || !opts.branch.upstream || opts.branch.upstreamGone) {
    return false;
  }
  if (!opts.branch.isCurrent) {
    return false;
  }

  const before = opts.previousSnapshot.get(opts.branch.name);
  if (!before || before.upstream || before.upstreamGone) {
    return false;
  }
  if (opts.hasExistingPr || opts.suppressed || opts.alreadyPrompted) {
    return false;
  }
  return true;
}

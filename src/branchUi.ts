import { Branch } from './git';
import { PullRequest } from './github';

export interface SyncStatus {
  text: string;
  tooltip: string;
  iconFile: string;
}

/** True when a local branch points at the same commit as the default branch. */
export function branchSharesDefaultTip(
  branch: Branch,
  defaultBranch: string,
  localBranches: Branch[]
): boolean {
  if (branch.isRemote || branch.name === defaultBranch) {
    return false;
  }
  const defaultRef = localBranches.find((b) => b.name === defaultBranch);
  return Boolean(defaultRef && branch.fullSha === defaultRef.fullSha);
}

export function splitRemoteBranch(ref: string): { remote: string; branch: string } {
  const slash = ref.indexOf('/');
  if (slash === -1) {
    return { remote: 'origin', branch: ref };
  }
  return {
    remote: ref.slice(0, slash),
    branch: ref.slice(slash + 1)
  };
}

export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1');
}

export function branchAheadBehindText(branch: Branch): string {
  const parts: string[] = [];
  if (branch.ahead > 0) parts.push(`${branch.ahead}↑`);
  if (branch.behind > 0) parts.push(`${branch.behind}↓`);
  return parts.join(' ');
}

export function branchSyncStateDescription(branch: Branch): string {
  if (!branch.upstream) {
    return 'Local only — never pushed to a remote.';
  }
  if (branch.upstreamGone) {
    return `Upstream ${branch.upstream} is gone.`;
  }
  if (branch.ahead === 0 && branch.behind === 0) {
    return `In sync with ${branch.upstream}.`;
  }

  const parts: string[] = [];
  if (branch.ahead > 0) {
    parts.push(`${branch.ahead} commit${branch.ahead === 1 ? '' : 's'} ahead of ${branch.upstream}`);
  }
  if (branch.behind > 0) {
    parts.push(`${branch.behind} commit${branch.behind === 1 ? '' : 's'} behind ${branch.upstream}`);
  }
  return parts.join(', ') + '.';
}

export function branchSyncStatus(branch: Branch): SyncStatus {
  if (branch.isRemote) {
    return { text: '', tooltip: 'Remote branch (not checked out locally).', iconFile: 'cloud-neutral' };
  }
  if (branch.isCurrent) {
    const extra = branchAheadBehindText(branch);
    return {
      text: extra || 'synced',
      tooltip: ['This is the checked-out branch.', branchSyncStateDescription(branch)].join('\n\n'),
      iconFile: 'check-green'
    };
  }
  if (!branch.upstream) {
    return {
      text: 'local only',
      tooltip: 'Local only — never pushed to a remote.',
      iconFile: 'cloud-upload-yellow'
    };
  }
  if (branch.upstreamGone) {
    return {
      text: 'upstream gone',
      tooltip: 'The remote branch was deleted (likely merged). Safe to clean up.',
      iconFile: 'warning-orange'
    };
  }
  if (branch.ahead === 0 && branch.behind === 0) {
    return { text: 'synced', tooltip: 'In sync with its remote.', iconFile: 'cloud-blue' };
  }
  const text = branchAheadBehindText(branch);
  return {
    text,
    tooltip: `Out of sync with ${branch.upstream}: ${text}.`,
    iconFile: branch.ahead > 0 ? 'arrow-up-purple' : 'arrow-down-purple'
  };
}

export function isBranchStale(branch: Branch, staleAfterDays: number, nowMs = Date.now()): boolean {
  if (staleAfterDays <= 0 || branch.isCurrent) {
    return false;
  }
  const ageDays = (nowMs / 1000 - branch.committerDateUnix) / 86400;
  return ageDays > staleAfterDays;
}

export function buildBranchContextValue(branch: Branch, defaultBranch: string, hasPr: boolean): string {
  const ctx: string[] = ['branch'];
  ctx.push(branch.isRemote ? 'remote' : 'local');
  if (branch.upstream && !branch.upstreamGone) ctx.push('upstream');
  if (branch.isCurrent) ctx.push('current');
  if (!branch.isRemote && branch.name === defaultBranch) ctx.push('default');
  if (hasPr) ctx.push('has-pr');
  return ctx.join('-');
}

export function buildBranchDescription(
  branch: Branch,
  opts: {
    defaultBranch: string;
    staleAfterDays: number;
    localBranches?: Branch[];
    pr?: PullRequest;
    nowMs?: number;
  }
): string {
  const status = branchSyncStatus(branch);
  const hints: string[] = [status.text, branch.committerDateRelative];
  if (!branch.isRemote && branch.name === opts.defaultBranch) hints.push('default');
  if (branch.merged && !branchSharesDefaultTip(branch, opts.defaultBranch, opts.localBranches ?? [])) {
    hints.push('merged');
  }
  if (isBranchStale(branch, opts.staleAfterDays, opts.nowMs)) hints.push('stale');

  const pr = opts.pr;
  if (pr) {
    if (pr.state === 'open') {
      hints.push(`PR #${pr.number}`);
    } else if (pr.mergedAt) {
      hints.push(`PR #${pr.number} (merged)`);
    } else {
      hints.push(`PR #${pr.number} (closed)`);
    }
  }

  return hints.filter(Boolean).join(' · ');
}

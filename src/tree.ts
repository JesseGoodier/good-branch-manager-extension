import * as vscode from 'vscode';
import { Branch, CommitEntry, Git, RemoteRepo, RepoInfo, findRepoRoot } from './git';
import { PullRequest, branchUrl, commitUrl, listPullRequests, resolveRemoteRepo } from './github';

type Node = GroupNode | BranchNode | CommitNode | LoadingNode;

export class GroupNode {
  constructor(public readonly kind: 'local' | 'remote', public readonly branches: Branch[]) {}
}

export class BranchNode {
  constructor(public readonly branch: Branch, public readonly repo: RepoInfo) {}
}

export class CommitNode {
  constructor(
    public readonly commit: CommitEntry,
    public readonly branch: Branch,
    public readonly repo: RepoInfo
  ) {}
}

class LoadingNode {
  constructor(public readonly message: string) {}
}

export class BranchTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private repoInfo: RepoInfo | undefined;
  private git: Git | undefined;
  private rootNodes: Node[] = [];
  private prMap = new Map<string, PullRequest>();
  private remoteRepos = new Map<string, RemoteRepo>();
  private commitCache = new Map<string, CommitNode[]>();
  private lastFetchTime = 0;
  private fetchPromise: Promise<void> | null = null;
  private isForceRefresh = false;
  private loadPromise: Promise<void> | null = null;
  private isLoading = false;

  getPullRequest(branchName: string): PullRequest | undefined {
    return this.prMap.get(branchName);
  }

  /** Start loading branch data immediately — call from activate before the view renders. */
  prefetch(): void {
    void this.ensureLoaded();
  }

  refresh(): void {
    this.isForceRefresh = true;
    this.commitCache.clear();
    this.loadPromise = null;
    void this.ensureLoaded(true);
  }

  getGit(): Git | undefined {
    return this.git;
  }

  getRepoInfo(): RepoInfo | undefined {
    return this.repoInfo;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (element instanceof GroupNode) {
      return element.branches.map((b) => new BranchNode(b, this.repoInfo!));
    }
    if (element instanceof BranchNode) {
      return this.getBranchCommits(element);
    }
    if (element instanceof CommitNode || element instanceof LoadingNode) {
      return [];
    }

    void this.ensureLoaded();
    if (this.isLoading && this.rootNodes.length === 0) {
      return [new LoadingNode('Loading branches…')];
    }
    return this.rootNodes;
  }

  private async ensureLoaded(force = false): Promise<void> {
    if (this.loadPromise && !force) {
      return this.loadPromise;
    }
    this.isLoading = true;
    if (force || this.rootNodes.length === 0) {
      this._onDidChangeTreeData.fire();
    }
    this.loadPromise = this.loadRootNodes(force).finally(() => {
      this.isLoading = false;
      this.loadPromise = null;
    });
    return this.loadPromise;
  }

  private async loadRootNodes(force: boolean): Promise<void> {
    const root = await findRepoRoot();
    if (!root) {
      this.git = undefined;
      this.repoInfo = undefined;
      this.rootNodes = [];
      this.prMap.clear();
      this.remoteRepos.clear();
      this._onDidChangeTreeData.fire();
      return;
    }

    this.git = new Git(root);
    try {
      this.repoInfo = await this.git.getBranches();
      await this.refreshRemoteRepos(this.git);
    } catch (err) {
      console.error('goodBranchManager: failed to list branches', err);
      this.rootNodes = [];
      this._onDidChangeTreeData.fire();
      return;
    }

    const scope = vscode.workspace.getConfiguration('goodBranchManager').get<string>('branchScope', 'both');
    if (scope === 'local' || this.repoInfo.remote.length === 0) {
      this.rootNodes = this.repoInfo.local.map((b) => new BranchNode(b, this.repoInfo!));
    } else {
      this.rootNodes = [
        new GroupNode('local', this.repoInfo.local),
        new GroupNode('remote', this.repoInfo.remote)
      ];
    }

    this._onDidChangeTreeData.fire();
    this.triggerPrFetch(this.git, force);
  }

  private async getBranchCommits(node: BranchNode): Promise<CommitNode[]> {
    const key = node.branch.name;
    const cached = this.commitCache.get(key);
    if (cached) {
      return cached;
    }

    const git = this.git;
    if (!git) {
      return [];
    }

    try {
      const commits = await git.getBranchCommits(node.branch.name);
      const items = commits.map((commit) => new CommitNode(commit, node.branch, node.repo));
      this.commitCache.set(key, items);
      return items;
    } catch (err) {
      console.error('goodBranchManager: failed to list commits', err);
      return [];
    }
  }

  private async triggerPrFetch(git: Git, force: boolean): Promise<void> {
    const showPrStatus = vscode.workspace.getConfiguration('goodBranchManager').get<boolean>('showPrStatus', true);
    if (!showPrStatus) {
      return;
    }

    const now = Date.now();
    const throttleMs = 30000;
    if (!force && !this.isForceRefresh && now - this.lastFetchTime < throttleMs) {
      return;
    }
    if (this.fetchPromise) {
      return;
    }

    this.isForceRefresh = false;

    this.fetchPromise = (async () => {
      try {
        let repo = await resolveRemoteRepo(git, 'origin');
        if (!repo || repo.provider !== 'github') {
          try {
            const remotesRaw = await git.exec(['remote']);
            const remotes = remotesRaw.split('\n').map(r => r.trim()).filter(Boolean);
            for (const remote of remotes) {
              if (remote === 'origin') continue;
              const r = await resolveRemoteRepo(git, remote);
              if (r && r.provider === 'github') {
                repo = r;
                break;
              }
            }
          } catch {
            // ignore
          }
        }

        if (repo && repo.provider === 'github') {
          const prs = await listPullRequests(repo);
          const newMap = new Map<string, PullRequest>();
          for (const pr of [...prs].reverse()) {
            newMap.set(pr.headRef, pr);
          }
          this.prMap = newMap;
          this.lastFetchTime = Date.now();
          this._onDidChangeTreeData.fire();
        }
      } catch (err) {
        console.error('goodBranchManager: failed to fetch PRs', err);
      } finally {
        this.fetchPromise = null;
      }
    })();
  }

  getTreeItem(element: Node): vscode.TreeItem {
    if (element instanceof LoadingNode) {
      const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('loading~spin');
      return item;
    }
    if (element instanceof GroupNode) {
      const item = new vscode.TreeItem(
        element.kind === 'local' ? 'Local' : 'Remote',
        element.kind === 'local'
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      );
      item.contextValue = `group-${element.kind}`;
      item.iconPath = new vscode.ThemeIcon(element.kind === 'local' ? 'device-desktop' : 'cloud');
      return item;
    }
    if (element instanceof CommitNode) {
      return this.commitItem(element);
    }
    return this.branchItem(element);
  }

  private branchItem(node: BranchNode): vscode.TreeItem {
    const b = node.branch;
    const item = new vscode.TreeItem(
      b.isRemote ? b.shortName : b.name,
      vscode.TreeItemCollapsibleState.Collapsed
    );
    item.id = (b.isRemote ? 'remote:' : 'local:') + b.name;

    const staleDays = vscode.workspace.getConfiguration('goodBranchManager').get<number>('staleAfterDays', 30);
    const ageDays = (Date.now() / 1000 - b.committerDateUnix) / 86400;
    const isStale = staleDays > 0 && ageDays > staleDays && !b.isCurrent;

    const showPrStatus = vscode.workspace.getConfiguration('goodBranchManager').get<boolean>('showPrStatus', true);
    const branchName = b.isRemote ? b.shortName : b.name;
    const pr = showPrStatus ? this.prMap.get(branchName) : undefined;

    const status = this.syncStatus(b);
    const hints: string[] = [status.text, b.committerDateRelative];
    if (!b.isRemote && b.name === node.repo.defaultBranch) hints.push('default');
    if (b.merged) hints.push('merged');
    if (isStale) hints.push('stale');

    if (pr) {
      if (pr.state === 'open') {
        hints.push(`PR #${pr.number}`);
      } else if (pr.mergedAt) {
        hints.push(`PR #${pr.number} (merged)`);
      } else {
        hints.push(`PR #${pr.number} (closed)`);
      }
    }

    item.description = hints.filter(Boolean).join(' · ');

    if (pr && !b.isCurrent) {
      if (pr.state === 'open') {
        item.iconPath = new vscode.ThemeIcon('git-pull-request', new vscode.ThemeColor('charts.green'));
      } else if (pr.mergedAt) {
        item.iconPath = new vscode.ThemeIcon('git-pull-request-merged', new vscode.ThemeColor('charts.purple'));
      } else {
        item.iconPath = new vscode.ThemeIcon('git-pull-request-closed', new vscode.ThemeColor('charts.red'));
      }
    } else {
      item.iconPath = new vscode.ThemeIcon(status.icon, status.color ? new vscode.ThemeColor(status.color) : undefined);
    }

    const lines = [
      `**${b.name}**`,
      '',
      `${status.tooltip}`,
      `Last commit: ${this.linkedCommit(b)} ${b.committerDateRelative}`,
      `Last Commit by: ${escapeMarkdown(b.authorName || 'Unknown')}`
    ];
    if (b.upstream) lines.push(`Upstream: ${this.linkedUpstream(b.upstream)}`);
    if (!b.isRemote && b.name === node.repo.defaultBranch) lines.push('Default branch.');
    if (b.merged) lines.push('Already merged into the default branch.');
    if (isStale) lines.push(`Stale: no commits in over ${staleDays} days.`);

    if (pr) {
      const prStatus = pr.state === 'open' ? 'open' : (pr.mergedAt ? 'merged' : 'closed');
      lines.push(`Pull Request: [#${pr.number} - ${pr.title}](${pr.htmlUrl}) (${prStatus})`);
    }

    item.tooltip = new vscode.MarkdownString(lines.join('\n\n'));
    item.tooltip.isTrusted = true;

    const ctx: string[] = ['branch'];
    ctx.push(b.isRemote ? 'remote' : 'local');
    if (b.upstream && !b.upstreamGone) ctx.push('upstream');
    if (b.isCurrent) ctx.push('current');
    if (!b.isRemote && b.name === node.repo.defaultBranch) ctx.push('default');
    if (pr) ctx.push('has-pr');
    item.contextValue = ctx.join('-');

    return item;
  }

  private commitItem(node: CommitNode): vscode.TreeItem {
    const c = node.commit;
    const item = new vscode.TreeItem(c.subject, vscode.TreeItemCollapsibleState.None);
    item.id = `commit:${node.branch.name}:${c.fullSha}`;
    item.description = `${c.sha} · ${c.authorName} · ${c.committerDateRelative}`;
    item.iconPath = new vscode.ThemeIcon('git-commit');

    const linkedSha = this.linkedCommitSha(node.branch, c.fullSha, c.sha);
    item.tooltip = new vscode.MarkdownString(
      [`**${escapeMarkdown(c.subject)}**`, '', `${linkedSha} · ${c.committerDateRelative}`, `Author: ${escapeMarkdown(c.authorName)}`].join('\n\n')
    );
    item.tooltip.isTrusted = true;
    item.contextValue = 'commit';

    const remoteRepo = this.remoteRepoForBranch(node.branch);
    if (remoteRepo) {
      item.command = {
        command: 'goodBranchManager.openCommit',
        title: 'Open Commit',
        arguments: [node]
      };
    }

    return item;
  }

  private syncStatus(b: Branch): { text: string; tooltip: string; icon: string; color?: string } {
    if (b.isRemote) {
      return { text: '', tooltip: 'Remote branch (not checked out locally).', icon: 'cloud' };
    }
    if (b.isCurrent) {
      const extra = this.aheadBehindText(b);
      return {
        text: extra || 'synced',
        tooltip: ['This is the checked-out branch.', this.syncStateDescription(b)].join('\n\n'),
        icon: 'check',
        color: 'charts.green'
      };
    }
    if (!b.upstream) {
      return {
        text: 'local only',
        tooltip: 'Local only — never pushed to a remote.',
        icon: 'cloud-upload',
        color: 'charts.yellow'
      };
    }
    if (b.upstreamGone) {
      return {
        text: 'upstream gone',
        tooltip: 'The remote branch was deleted (likely merged). Safe to clean up.',
        icon: 'warning',
        color: 'charts.orange'
      };
    }
    if (b.ahead === 0 && b.behind === 0) {
      return { text: 'synced', tooltip: 'In sync with its remote.', icon: 'cloud', color: 'charts.blue' };
    }
    const text = this.aheadBehindText(b);
    return {
      text,
      tooltip: `Out of sync with ${b.upstream}: ${text}.`,
      icon: b.ahead > 0 ? 'arrow-up' : 'arrow-down',
      color: 'charts.purple'
    };
  }

  private aheadBehindText(b: Branch): string {
    const parts: string[] = [];
    if (b.ahead > 0) parts.push(`${b.ahead}↑`);
    if (b.behind > 0) parts.push(`${b.behind}↓`);
    return parts.join(' ');
  }

  private syncStateDescription(b: Branch): string {
    if (!b.upstream) {
      return 'Local only — never pushed to a remote.';
    }
    if (b.upstreamGone) {
      return `Upstream ${b.upstream} is gone.`;
    }
    if (b.ahead === 0 && b.behind === 0) {
      return `In sync with ${b.upstream}.`;
    }

    const parts: string[] = [];
    if (b.ahead > 0) {
      parts.push(`${b.ahead} commit${b.ahead === 1 ? '' : 's'} ahead of ${b.upstream}`);
    }
    if (b.behind > 0) {
      parts.push(`${b.behind} commit${b.behind === 1 ? '' : 's'} behind ${b.upstream}`);
    }
    return parts.join(', ') + '.';
  }

  private async refreshRemoteRepos(git: Git): Promise<void> {
    const next = new Map<string, RemoteRepo>();
    try {
      const remotesRaw = await git.exec(['remote']);
      const remotes = remotesRaw.split('\n').map((remote) => remote.trim()).filter(Boolean);
      for (const remote of remotes) {
        const repo = await resolveRemoteRepo(git, remote);
        if (repo) {
          next.set(remote, repo);
        }
      }
    } catch {
      // Keep the branch list usable even when remotes cannot be inspected.
    }
    this.remoteRepos = next;
  }

  private linkedCommit(branch: Branch): string {
    const label = escapeMarkdown(branch.sha);
    if (!branch.isRemote && branch.ahead > 0) {
      return `\`${label}\``;
    }
    const repo = this.remoteRepoForBranch(branch);
    if (!repo) {
      return `\`${label}\``;
    }
    return `[${label}](${commitUrl(repo, branch.fullSha || branch.sha)})`;
  }

  private linkedCommitSha(branch: Branch, fullSha: string, shortSha: string): string {
    const repo = this.remoteRepoForBranch(branch);
    const label = escapeMarkdown(shortSha);
    if (!repo) {
      return `\`${label}\``;
    }
    return `[${label}](${commitUrl(repo, fullSha)})`;
  }

  private linkedUpstream(upstream: string): string {
    const { remote, branch } = splitRemoteBranch(upstream);
    const label = escapeMarkdown(upstream);
    const repo = this.remoteRepos.get(remote);
    if (!repo) {
      return `\`${label}\``;
    }
    return `[${label}](${branchUrl(repo, branch)})`;
  }

  private remoteRepoForBranch(branch: Branch): RemoteRepo | undefined {
    if (branch.upstream) {
      return this.remoteRepos.get(splitRemoteBranch(branch.upstream).remote);
    }
    if (branch.remote) {
      return this.remoteRepos.get(branch.remote);
    }
    return this.remoteRepos.get('origin');
  }
}

function splitRemoteBranch(ref: string): { remote: string; branch: string } {
  const slash = ref.indexOf('/');
  if (slash === -1) {
    return { remote: 'origin', branch: ref };
  }
  return {
    remote: ref.slice(0, slash),
    branch: ref.slice(slash + 1)
  };
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!|>])/g, '\\$1');
}

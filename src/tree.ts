import * as vscode from 'vscode';
import { Branch, CommitEntry, Git, RemoteRepo, RepoInfo, findRepoRoot } from './git';
import {
  branchSharesDefaultTip,
  branchSyncStatus,
  buildBranchContextValue,
  buildBranchDescription,
  buildMergeStatusTooltip,
  escapeMarkdown,
  isBranchMergedDisplay,
  isBranchStale,
  resolveBranchBaseRef,
  splitRemoteBranch
} from './branchUi';
import { PullRequest, branchUrl, commitUrl, listPullRequests, resolveRemoteRepo } from './github';

type Node = GroupNode | BranchNode | CommitNode | LoadingNode | InfoNode;

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

class InfoNode {
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
  private commitCache = new Map<string, Node[]>();
  private lastFetchTime = 0;
  private fetchPromise: Promise<void> | null = null;
  private isForceRefresh = false;
  private loadPromise: Promise<void> | null = null;
  private isLoading = false;
  private dataReady = false;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Resolves a colored icon shipped under media/. Custom SVGs are used instead of themed
   * codicons because VS Code repaints a selected row's codicon with the selection foreground
   * (an !important rule that a ThemeColor cannot override); image icons keep their own color.
   */
  private icon(name: string): { light: vscode.Uri; dark: vscode.Uri } {
    return {
      light: vscode.Uri.joinPath(this.extensionUri, 'media', 'light', `${name}.svg`),
      dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'dark', `${name}.svg`)
    };
  }

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
    if (element instanceof CommitNode || element instanceof LoadingNode || element instanceof InfoNode) {
      return [];
    }

    if (!this.dataReady && this.isLoading) {
      return [new LoadingNode('Loading branches…')];
    }
    return this.rootNodes;
  }

  private async ensureLoaded(force = false): Promise<void> {
    if (!force) {
      if (this.loadPromise) {
        return this.loadPromise;
      }
      if (this.dataReady) {
        return;
      }
    }

    this.isLoading = true;
    if (!this.dataReady) {
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
      this.dataReady = true;
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
      this.dataReady = true;
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

    this.dataReady = true;
    this._onDidChangeTreeData.fire();
    this.triggerPrFetch(this.git, force);
  }

  private async getBranchCommits(node: BranchNode): Promise<Node[]> {
    const showBase = vscode.workspace
      .getConfiguration('goodBranchManager')
      .get<boolean>('showBaseBranchCommits', false);
    const baseRef = resolveBranchBaseRef(node.branch, node.repo.defaultBranch);
    const branchOnly = !showBase && baseRef !== undefined;
    const cacheKey = `${node.branch.name}:${branchOnly}`;
    const cached = this.commitCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const git = this.git;
    if (!git) {
      return [];
    }

    try {
      const commits = await git.getBranchCommits(node.branch.name, 30, branchOnly ? baseRef : undefined);
      const items: Node[] =
        commits.length === 0 && branchOnly
          ? [new InfoNode('No commits on this branch yet.')]
          : commits.map((commit) => new CommitNode(commit, node.branch, node.repo));
      this.commitCache.set(cacheKey, items);
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
    if (element instanceof InfoNode) {
      const item = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
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
      item.iconPath = this.icon(element.kind === 'local' ? 'vm-neutral' : 'cloud-neutral');
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

    const staleDays = vscode.workspace.getConfiguration('goodBranchManager').get<number>('staleAfterDays', 10);
    const isStale = isBranchStale(b, staleDays);

    const showPrStatus = vscode.workspace.getConfiguration('goodBranchManager').get<boolean>('showPrStatus', true);
    const branchName = b.isRemote ? b.shortName : b.name;
    const pr = showPrStatus ? this.prMap.get(branchName) : undefined;

    const status = branchSyncStatus(b);

    const sharesDefaultTip = branchSharesDefaultTip(b, node.repo.defaultBranch, node.repo.local);
    const mergedDisplay = isBranchMergedDisplay(b, {
      defaultBranch: node.repo.defaultBranch,
      localBranches: node.repo.local,
      pr
    });

    item.description = buildBranchDescription(b, {
      defaultBranch: node.repo.defaultBranch,
      staleAfterDays: staleDays,
      localBranches: node.repo.local,
      pr
    });

    if (pr && !b.isCurrent) {
      if (pr.state === 'open') {
        item.iconPath = this.icon('git-pull-request-green');
      } else if (pr.mergedAt) {
        item.iconPath = this.icon('git-merge-purple');
      } else {
        item.iconPath = this.icon('git-pull-request-closed-red');
      }
    } else if (mergedDisplay && !b.isCurrent) {
      item.iconPath = this.icon('git-merge-purple');
    } else {
      item.iconPath = this.icon(status.iconFile);
    }

    const lines = [
      `**${b.name}**`,
      '',
      `${status.tooltip}`
    ];
    if (sharesDefaultTip) {
      lines.push('This branch is up to date with the default branch.');
    } else {
      lines.push(
        `Last commit: ${this.linkedCommit(b)} ${b.committerDateRelative}`,
        `Last Commit by: ${escapeMarkdown(b.authorName || 'Unknown')}`
      );
    }
    if (b.upstream) lines.push(`Upstream: ${this.linkedUpstream(b.upstream)}`);
    if (!b.isRemote && b.name === node.repo.defaultBranch) lines.push('Default branch.');
    const mergeLine = buildMergeStatusTooltip(node.repo.defaultBranch, {
      pr,
      gitMerged: mergedDisplay && !pr?.mergedAt
    });
    if (mergeLine) lines.push(mergeLine);
    if (isStale) lines.push(`Stale: no commits in over ${staleDays} days.`);

    if (pr) {
      const prStatus = pr.state === 'open' ? 'open' : (pr.mergedAt ? 'merged' : 'closed');
      lines.push(`Pull Request: [#${pr.number} - ${escapeMarkdown(pr.title)}](${pr.htmlUrl}) (${prStatus})`);
    }

    item.tooltip = new vscode.MarkdownString(lines.join('\n\n'));
    item.tooltip.isTrusted = true;

    item.contextValue = buildBranchContextValue(b, node.repo.defaultBranch, Boolean(pr));

    return item;
  }

  private commitItem(node: CommitNode): vscode.TreeItem {
    const c = node.commit;
    const item = new vscode.TreeItem(c.subject, vscode.TreeItemCollapsibleState.None);
    item.id = `commit:${node.branch.name}:${c.fullSha}`;
    item.description = `${c.sha} · ${c.authorName} · ${c.committerDateRelative}`;
    item.iconPath = this.icon('git-commit-neutral');

    const linkedSha = this.linkedCommitSha(node.branch, c.fullSha, c.sha);
    item.tooltip = new vscode.MarkdownString(
      [`**${escapeMarkdown(c.subject)}**`, '', `${linkedSha} · ${c.committerDateRelative}`, `Author: ${escapeMarkdown(c.authorName)}`].join('\n\n')
    );
    item.tooltip.isTrusted = true;
    item.contextValue = 'commit';

    item.command = {
      command: 'goodBranchManager.openCommit',
      title: 'Show Commit',
      arguments: [node]
    };

    return item;
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

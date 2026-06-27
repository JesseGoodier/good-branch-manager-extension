import * as vscode from 'vscode';
import { Git, RemoteRepo } from './git';

export type { RemoteRepo };

export async function resolveRemoteRepo(git: Git, remote = 'origin'): Promise<RemoteRepo | undefined> {
  const url = await git.getRemoteUrl(remote);
  return url ? Git.parseRemoteUrl(url) : undefined;
}

/** Legacy alias kept for the PR creation flow, which is GitHub-only. */
export async function resolveGitHubRepo(git: Git, remote = 'origin'): Promise<RemoteRepo | undefined> {
  const repo = await resolveRemoteRepo(git, remote);
  return repo?.provider === 'github' ? repo : undefined;
}

export async function getGitHubSession(createIfNone: boolean): Promise<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession('github', ['repo'], { createIfNone });
}

export function isGitHubAuthError(status: number, message: string): boolean {
  const lower = message.toLowerCase();
  return (
    status === 401 ||
    lower.includes('bad credentials') ||
    lower.includes('requires authentication') ||
    lower.includes('invalid token') ||
    lower.includes('token is expired')
  );
}

/** Prompt the user to sign in again using VS Code's built-in GitHub authentication. */
export async function promptGitHubSignIn(action: string): Promise<vscode.AuthenticationSession | undefined> {
  const signIn = 'Sign In to GitHub';
  const picked = await vscode.window.showWarningMessage(
    `GitHub authentication failed. Sign in to ${action}?`,
    signIn
  );
  if (picked !== signIn) {
    return undefined;
  }
  return vscode.authentication.getSession('github', ['repo'], {
    forceNewSession: { detail: `Good Branch Manager needs GitHub access to ${action}.` }
  });
}

export interface CreatePrInput {
  title: string;
  body: string;
  base: string;
  head: string;
  draft: boolean;
}

export interface CreatedPr {
  htmlUrl: string;
  number: number;
}

/** REST API base URL for GitHub.com and GitHub Enterprise hosts. */
export function githubApiBase(repo: RemoteRepo): string {
  const h = repo.host.toLowerCase();
  if (h === 'github.com') {
    return 'https://api.github.com';
  }
  if (h.endsWith('.github.com')) {
    return `https://api.${h}`;
  }
  return `https://${h}/api/v3`;
}

export async function createPullRequest(repo: RemoteRepo, input: CreatePrInput): Promise<CreatedPr> {
  let session = await getGitHubSession(true);
  if (!session) {
    throw new Error('GitHub sign-in is required to create a pull request.');
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await postPullRequest(repo, input, session.accessToken);
    if (result.ok) {
      return result.pr;
    }
    if (attempt === 0 && isGitHubAuthError(result.status, result.message)) {
      const refreshed = await promptGitHubSignIn('create pull requests');
      if (!refreshed) {
        throw new Error('GitHub sign-in is required to create a pull request.');
      }
      session = refreshed;
      continue;
    }
    throw new Error(result.message);
  }

  throw new Error('GitHub sign-in is required to create a pull request.');
}

async function postPullRequest(
  repo: RemoteRepo,
  input: CreatePrInput,
  accessToken: string
): Promise<{ ok: true; pr: CreatedPr } | { ok: false; status: number; message: string }> {
  const res = await fetch(`${githubApiBase(repo)}/repos/${repo.owner}/${repo.repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      base: input.base,
      head: input.head,
      draft: input.draft
    })
  });
  if (!res.ok) {
    const detail = await res.text();
    let message = `GitHub API error ${res.status}`;
    try {
      const parsed = JSON.parse(detail);
      const errors = (parsed.errors ?? []).map((e: any) => e.message ?? JSON.stringify(e)).join('; ');
      message = [parsed.message, errors].filter(Boolean).join(' — ');
    } catch {
      // keep generic message
    }
    return { ok: false, status: res.status, message };
  }
  const json: any = await res.json();
  return { ok: true, pr: { htmlUrl: json.html_url, number: json.number } };
}

/** Encode a branch/ref name for use in URL paths, preserving slash separators. */
function encodeBranchRef(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

/** Browser URL for a remote repository's home page. */
export function repoHomeUrl(repo: RemoteRepo): string {
  const base = `https://${repo.host}`;

  switch (repo.provider) {
    case 'github':
      return `${base}/${repo.owner}/${repo.repo}`;

    case 'gitlab':
      return `${base}/${repo.owner}/${repo.repo}`;

    case 'bitbucket':
      return `${base}/${repo.owner}/${repo.repo}`;

    case 'azure': {
      const parts = repo.owner.split('/');
      const org = parts[0];
      const project = parts.slice(1).join('/') || repo.repo;
      return `https://dev.azure.com/${org}/${project}/_git/${repo.repo}`;
    }

    default:
      return `${base}/${repo.owner}/${repo.repo}`;
  }
}

/** Browser URL for a specific branch on a remote repository. */
export function branchUrl(repo: RemoteRepo, branch: string): string {
  const enc = encodeBranchRef(branch);
  const base = `https://${repo.host}`;

  switch (repo.provider) {
    case 'github':
      return `${base}/${repo.owner}/${repo.repo}/tree/${enc}`;

    case 'gitlab':
      // GitLab uses /-/tree/ and supports nested namespace owners (group/subgroup).
      return `${base}/${repo.owner}/${repo.repo}/-/tree/${enc}`;

    case 'bitbucket':
      return `${base}/${repo.owner}/${repo.repo}/src/${enc}`;

    case 'azure': {
      // Azure DevOps HTTPS: dev.azure.com/org/project/_git/repo
      // SSH remote was normalised to "org/project/repo" during parsing,
      // so owner = "org/project" and repo = "repo".
      const parts = repo.owner.split('/');
      const org = parts[0];
      const project = parts.slice(1).join('/') || repo.repo;
      return `https://dev.azure.com/${org}/${project}/_git/${repo.repo}?version=GB${enc}`;
    }

    default:
      // Gitea / Forgejo use /src/branch/; Gogs uses /src/ without the branch segment.
      return `${base}/${repo.owner}/${repo.repo}/src/branch/${enc}`;
  }
}

export function commitUrl(repo: RemoteRepo, sha: string): string {
  const enc = encodeURIComponent(sha);
  const base = `https://${repo.host}`;

  switch (repo.provider) {
    case 'github':
      return `${base}/${repo.owner}/${repo.repo}/commit/${enc}`;

    case 'gitlab':
      return `${base}/${repo.owner}/${repo.repo}/-/commit/${enc}`;

    case 'bitbucket':
      return `${base}/${repo.owner}/${repo.repo}/commits/${enc}`;

    case 'azure': {
      const parts = repo.owner.split('/');
      const org = parts[0];
      const project = parts.slice(1).join('/') || repo.repo;
      return `https://dev.azure.com/${org}/${project}/_git/${repo.repo}/commit/${enc}`;
    }

    default:
      return `${base}/${repo.owner}/${repo.repo}/commit/${enc}`;
  }
}

export interface PullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed';
  mergedAt: string | null;
  mergedBy: string | null;
  htmlUrl: string;
  headRef: string;
}

export async function listPullRequests(repo: RemoteRepo): Promise<PullRequest[]> {
  const session = await getGitHubSession(false);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (session) {
    headers['Authorization'] = `Bearer ${session.accessToken}`;
  }

  const res = await fetch(`${githubApiBase(repo)}/repos/${repo.owner}/${repo.repo}/pulls?state=all&per_page=100`, {
    headers
  });

  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
  }

  const json = await res.json() as any[];
  return json.map((pr: any) => ({
    number: pr.number,
    title: pr.title ?? '',
    state: pr.state,
    mergedAt: pr.merged_at || null,
    mergedBy: pr.merged_by?.login ?? null,
    htmlUrl: pr.html_url,
    headRef: pr.head.ref
  }));
}

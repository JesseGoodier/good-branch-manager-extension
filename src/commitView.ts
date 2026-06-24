import * as vscode from 'vscode';
import { Git } from './git';
import { RemoteRepo } from './github';
import { openCommitPanel } from './commitPanel';

/** Opens a commit in VS Code's native multi-file diff editor (side-by-side). */
export async function openCommitView(
  git: Git,
  fullSha: string,
  branchName: string,
  remoteRepo?: RemoteRepo
): Promise<void> {
  if (await tryOpenNativeCommitView(git.repoRoot, fullSha)) {
    return;
  }

  const details = await git.getCommitDetails(fullSha);
  if (!details) {
    vscode.window.showWarningMessage(`Could not load commit ${fullSha.slice(0, 7)}.`);
    return;
  }
  await openCommitPanel(details, branchName, remoteRepo);
}

async function tryOpenNativeCommitView(repoRoot: string, fullSha: string): Promise<boolean> {
  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) {
    return false;
  }

  try {
    const api = (await gitExt.activate()).getAPI(1);
    const repo = api.getRepository(vscode.Uri.file(repoRoot));
    if (!repo) {
      return false;
    }
    await vscode.commands.executeCommand('git.viewCommit', repo, fullSha);
    return true;
  } catch (err) {
    console.error('goodBranchManager: git.viewCommit failed', err);
    return false;
  }
}

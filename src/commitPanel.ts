import * as vscode from 'vscode';
import { CommitDetails } from './git';
import { RemoteRepo, commitUrl } from './github';

export async function openCommitPanel(
  details: CommitDetails,
  branchName: string,
  remoteRepo?: RemoteRepo
): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'goodBranchManager.commit',
    `${details.shortSha}: ${truncate(details.subject, 48)}`,
    vscode.ViewColumn.Active,
    { enableScripts: Boolean(remoteRepo) }
  );
  panel.webview.html = renderHtml(panel.webview, details, branchName, remoteRepo);

  if (!remoteRepo) {
    return;
  }

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.type === 'openRemote') {
      await vscode.env.openExternal(vscode.Uri.parse(commitUrl(remoteRepo, details.fullSha)));
    }
  });
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderDiff(patch: string): string {
  if (!patch.trim()) {
    return '<div class="empty-diff">No file changes in this commit.</div>';
  }
  return patch
    .split('\n')
    .map((line) => {
      const escaped = escapeHtml(line);
      if (line.startsWith('diff --git') || line.startsWith('+++') || line.startsWith('---')) {
        return `<span class="diff-file">${escaped}</span>`;
      }
      if (line.startsWith('@@')) {
        return `<span class="diff-hunk">${escaped}</span>`;
      }
      if (line.startsWith('+')) {
        return `<span class="diff-add">${escaped}</span>`;
      }
      if (line.startsWith('-')) {
        return `<span class="diff-del">${escaped}</span>`;
      }
      return `<span class="diff-ctx">${escaped}</span>`;
    })
    .join('\n');
}

function renderHtml(
  webview: vscode.Webview,
  details: CommitDetails,
  branchName: string,
  remoteRepo?: RemoteRepo
): string {
  const nonce = Math.random().toString(36).slice(2);
  const stats =
    details.filesChanged > 0
      ? `${details.filesChanged} file${details.filesChanged === 1 ? '' : 's'} changed` +
        ` · <span class="add">+${details.insertions}</span>` +
        ` · <span class="del">-${details.deletions}</span>`
      : 'No file changes';

  const bodyBlock = details.body
    ? `<div class="message-body">${escapeHtml(details.body).replace(/\n/g, '<br>')}</div>`
    : '';

  const remoteButton = remoteRepo
    ? `<button id="open-remote" class="secondary">Open on ${escapeHtml(remoteRepo.host)}</button>`
    : '';

  const script = remoteRepo
    ? `<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('open-remote')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'openRemote' });
  });
</script>`
    : '';

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    margin: 0;
    padding: 16px 20px 24px;
  }
  h2 {
    font-weight: 500;
    margin: 0 0 6px;
    line-height: 1.35;
  }
  .meta {
    color: var(--vscode-descriptionForeground);
    margin-bottom: 16px;
    line-height: 1.5;
  }
  .meta code {
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .stats {
    margin-bottom: 16px;
    color: var(--vscode-descriptionForeground);
  }
  .stats .add { color: var(--vscode-gitDecoration-addedResourceForeground, #73c991); }
  .stats .del { color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c); }
  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vscode-descriptionForeground);
    margin: 18px 0 8px;
  }
  .message-body {
    white-space: pre-wrap;
    background: var(--vscode-textBlockQuote-background);
    border-left: 3px solid var(--vscode-textBlockQuote-border);
    padding: 10px 12px;
    border-radius: 0 3px 3px 0;
    line-height: 1.45;
  }
  pre.diff {
    margin: 0;
    padding: 12px;
    overflow: auto;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border, transparent);
    border-radius: 4px;
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    line-height: 1.45;
    white-space: pre;
  }
  pre.diff span { display: block; }
  .diff-file { color: var(--vscode-textLink-foreground); }
  .diff-hunk { color: var(--vscode-textPreformat-foreground); }
  .diff-add {
    background: var(--vscode-diffEditor-insertedLineBackground, rgba(155, 185, 85, 0.2));
  }
  .diff-del {
    background: var(--vscode-diffEditor-removedLineBackground, rgba(255, 0, 0, 0.2));
  }
  .empty-diff {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    padding: 8px 0;
  }
  .actions { margin-top: 18px; }
  button {
    border: none;
    border-radius: 3px;
    padding: 7px 16px;
    cursor: pointer;
    font-size: inherit;
  }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
</style>
</head>
<body>
  <h2>${escapeHtml(details.subject)}</h2>
  <div class="meta">
  <code>${escapeHtml(details.shortSha)}</code> on <code>${escapeHtml(branchName)}</code><br>
  ${escapeHtml(details.authorName)} &lt;${escapeHtml(details.authorEmail)}&gt;<br>
  ${escapeHtml(details.authorDate)}
  </div>
  <div class="stats">${stats}</div>
  ${bodyBlock ? `<div class="section-label">Message</div>${bodyBlock}` : ''}
  <div class="section-label">Changes</div>
  <pre class="diff">${renderDiff(details.patch)}</pre>
  ${remoteButton ? `<div class="actions">${remoteButton}</div>` : ''}
  ${script}
</body>
</html>`;
}

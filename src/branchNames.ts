const BRANCH_NAME_RE = /^(?!\/|.*(?:\/\.|\/\/|\.\.|@\{|\\))[^\x00-\x20~^:?*[\]]+(?<!\.lock)(?<!\/)(?<!\.)$/;

/** Returns an error message when the name is invalid, otherwise undefined. */
export function validateBranchName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'Branch name is required.';
  }
  if (!BRANCH_NAME_RE.test(trimmed)) {
    return 'Not a valid git branch name.';
  }
  return undefined;
}

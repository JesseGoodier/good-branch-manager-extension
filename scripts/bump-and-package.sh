#!/usr/bin/env bash
set -euo pipefail

BUMP="${1:-patch}"
if [[ "$BUMP" != patch && "$BUMP" != minor && "$BUMP" != major ]]; then
  echo "Usage: $0 [patch|minor|major]" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Updating dependencies..."
npm update
npm audit fix

if ! npm audit --audit-level=moderate; then
  echo "Unresolved npm vulnerabilities remain. Check 'npm audit' before releasing." >&2
  exit 1
fi

echo "Bumping $BUMP version..."
npm version "$BUMP" --no-git-tag-version > /dev/null

VERSION=$(node -p "require('./package.json').version")
NAME=$(node -p "require('./package.json').name")
echo "Version -> $VERSION"

echo "Building..."
npm run build

echo "Packaging..."
npm run package

echo ""
echo "Done: $NAME-$VERSION.vsix"
echo "Install with: code --install-extension $NAME-$VERSION.vsix"

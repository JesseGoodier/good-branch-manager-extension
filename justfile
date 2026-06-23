set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    @just --list --unsorted

# Install dependencies from package-lock.json (CI-friendly).
install:
    npm ci

# Install or refresh dependencies for local development.
install-dev:
    npm install

# Compile TypeScript to out/.
build:
    npm run build

alias compile := build

# Recompile automatically on file changes.
watch:
    npm run watch

# Run unit and integration tests.
test:
    npm test

# Run fast unit tests only.
test-unit:
    npm run test:unit

# Run VS Code integration tests (needs a display or xvfb).
test-integration:
    npm run test:integration

# Run integration tests under a virtual framebuffer (headless Linux).
test-integration-xvfb:
    xvfb-run -a npm run test:integration

# Full local CI check: clean install, then all tests.
ci: install test

# Package a .vsix without changing the version.
package:
    npm run package

# Bump version, update deps, build, and package. Usage: just bump [patch|minor|major]
bump bump="patch":
    ./scripts/bump-and-package.sh {{ bump }}

# Tag and publish a GitHub release (requires gh CLI and a clean tree).
release:
    npm run release

# Update dependencies within semver ranges and apply audit fixes.
update-deps:
    npm update
    npm audit fix

# Show dependency vulnerabilities.
audit:
    npm audit

# Regenerate package-lock.json without running install scripts.
update-lockfile:
    npm run update-lockfile

# Remove build artifacts, test downloads, and packaged extensions.
clean:
    rm -rf out .vscode-test
    rm -f *.vsix

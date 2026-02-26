#!/usr/bin/env bash
set -euo pipefail

# Determine the original repo's tooling directory.
# The main worktree is the first entry in `git worktree list --porcelain`.
MAIN_WORKTREE=$(git worktree list --porcelain | head -1 | sed 's/^worktree //')
TOOLING_DIR=$(dirname "$MAIN_WORKTREE")

# Rewrite file:../ dependencies to absolute paths and run npm install.
fix_and_install() {
  local dir="$1"
  if [ -f "$dir/package.json" ] && grep -q '"file:\.\./' "$dir/package.json"; then
    sed -i '' "s|\"file:\\.\\./|\"file:${TOOLING_DIR}/|g" "$dir/package.json"
  fi
  if [ -f "$dir/package.json" ]; then
    (cd "$dir" && npm install)
  fi
}

# Fix the parent worktree
fix_and_install "$(pwd)"

# Fix child worktrees (subdirectories with a package.json)
for child in */; do
  if [ -d "$child" ]; then
    fix_and_install "$child"
  fi
done

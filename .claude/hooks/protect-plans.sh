#!/bin/bash
# Claude Code PreToolUse hook: blocks Edit and Write on plan files.
# Agents must use trellis MCP tools instead of direct file editing.

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Resolve the trellis config path (supports both file and directory format)
trellis_config_path() {
  local root="$1"
  if [ -f "$root/.trellis/config" ]; then
    echo "$root/.trellis/config"
  elif [ -f "$root/.trellis" ]; then
    echo "$root/.trellis"
  fi
}

# Find the project root by looking for .trellis (file or directory)
find_project_root() {
  local dir="$1"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/.trellis" ] || [ -f "$dir/.trellis/config" ]; then
      echo "$dir"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

# Try to find project root from the file path, then from cwd
PROJECT_ROOT=""
if PROJECT_ROOT=$(find_project_root "$(dirname "$FILE_PATH")") 2>/dev/null; then
  :
elif [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
  CONFIG_PATH=$(trellis_config_path "$CLAUDE_PROJECT_DIR")
  if [ -n "$CONFIG_PATH" ]; then
    PROJECT_ROOT="$CLAUDE_PROJECT_DIR"
  else
    exit 0
  fi
else
  # No .trellis found — not a trellis project, allow the operation
  exit 0
fi

# Read plans_dir from trellis config (default: plans)
PLANS_DIR="plans"
CONFIG_FILE=$(trellis_config_path "$PROJECT_ROOT")
if [ -n "$CONFIG_FILE" ]; then
  PARSED=$(grep '^plans_dir:' "$CONFIG_FILE" | sed 's/^plans_dir:\s*//' | sed 's/\s*#.*$//' | tr -d '[:space:]')
  if [ -n "$PARSED" ]; then
    PLANS_DIR="$PARSED"
  fi
fi

# Resolve to absolute path
PLANS_ABS="$PROJECT_ROOT/$PLANS_DIR"

# Normalize both paths (resolve symlinks, remove trailing slashes)
PLANS_ABS=$(cd "$PLANS_ABS" 2>/dev/null && pwd -P) || exit 0
FILE_DIR=$(cd "$(dirname "$FILE_PATH")" 2>/dev/null && pwd -P) || exit 0

# Check if the file is inside the plans directory
case "$FILE_DIR/" in
  "$PLANS_ABS/"*)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "Edit/Write"')
    echo "Plan files are managed by trellis. Use the trellis MCP tools (trellis_create, trellis_write_section, trellis_read_section, trellis_set, trellis_update) instead of $TOOL_NAME on plan files directly." >&2
    exit 2
    ;;
esac

exit 0

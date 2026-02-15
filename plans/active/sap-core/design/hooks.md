# sap — Claude Code Hooks Configuration

Last updated: 2026-02-14

## Overview

sap receives events from Claude Code via command hooks configured in `~/.claude/settings.json`. Each hook calls `sap record --event <type>`, which reads the hook's JSON payload from stdin.

## Hooks Configuration

Add to `~/.claude/settings.json` (or manage via dotfiles `claude/settings.json`):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "sap record --event session-start",
          "timeout": 5000
        }]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "sap record --event session-stop",
          "timeout": 5000
        }]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [{
          "type": "command",
          "command": "sap record --event attention-permission",
          "timeout": 5000
        }]
      },
      {
        "matcher": "idle_prompt",
        "hooks": [{
          "type": "command",
          "command": "sap record --event attention-idle",
          "timeout": 5000
        }]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "sap record --event user-prompt",
          "timeout": 5000
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "sap record --event tool-use",
          "timeout": 5000
        }]
      }
    ]
  }
}
```

## Hook Payload (stdin)

Claude Code sends JSON to stdin for all command hooks. Common fields:

```json
{
  "session_id": "unique-session-identifier",
  "cwd": "/absolute/path/to/working/directory",
  "transcript_path": "/path/to/transcript.jsonl",
  "hook_event_name": "PostToolUse"
}
```

Event-specific fields:
- **PostToolUse**: `tool_name`, `tool_input`, `tool_result`
- **UserPromptSubmit**: `user_prompt`
- **Stop**: `reason`
- **Notification**: notification type details

## What Each Event Captures

| Event | Triggers When | State Transition | Key Data |
|-------|--------------|-----------------|----------|
| `session-start` | Claude Code session begins | → active | session_id, cwd, transcript_path |
| `session-stop` | Agent stops (task done or user exit) | → stopped | reason |
| `attention-permission` | Claude needs permission approval | → attention | (notification details) |
| `attention-idle` | Claude idle 60+ seconds | → attention | (notification details) |
| `user-prompt` | User submits a prompt | → active | (clears attention state) |
| `tool-use` | Claude uses any tool | → active | tool_name, tool_input |

## Design Decisions

- **5 second timeout**: Hooks must be fast. sap record does a single SQLite write and exits.
- **PostToolUse over PreToolUse**: We want to know what happened, not what's about to happen. PostToolUse includes results.
- **All matchers are `*`** except Notification: We want all sessions, all tools, all prompts. Notification needs specific matchers for permission_prompt vs idle_prompt.
- **No PreToolUse hooks**: Too noisy for initial implementation. Can be added later for richer activity tracking.
- **UserPromptSubmit clears attention**: If the user typed something, Claude is no longer waiting. This is the reliable "attention resolved" signal.

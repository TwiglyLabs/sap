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
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "sap record --event session-end",
          "timeout": 5000
        }]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "sap record --event turn-complete",
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

Claude Code sends JSON to stdin for all command hooks. Common fields present in every event:

```json
{
  "session_id": "unique-session-identifier",
  "cwd": "/absolute/path/to/working/directory",
  "transcript_path": "/path/to/transcript.jsonl",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse"
}
```

Event-specific fields:
- **SessionStart**: `source` (`startup`, `resume`, `clear`, `compact`), `model`
- **SessionEnd**: `reason` (`clear`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other`)
- **Stop**: `stop_hook_active`
- **PostToolUse**: `tool_name`, `tool_input`, `tool_response`, `tool_use_id`
- **UserPromptSubmit**: `prompt`
- **Notification**: `message`, `title`, `notification_type`

## What Each Event Captures

| Event | Hook | Triggers When | State Transition | Key Data |
|-------|------|--------------|-----------------|----------|
| `session-start` | SessionStart | Session begins or resumes | → active (see source handling) | session_id, cwd, transcript_path, source |
| `session-end` | SessionEnd | Session terminates | → stopped | reason |
| `turn-complete` | Stop | Claude finishes a response turn | → idle | (awaiting user input) |
| `attention-permission` | Notification | Permission prompt shown | → attention | notification details |
| `attention-idle` | Notification | Claude idle 60+ seconds | → attention | notification details |
| `user-prompt` | UserPromptSubmit | User submits a prompt | → active | clears attention/idle state |
| `tool-use` | PostToolUse | Claude uses any tool | → active | tool_name, tool_input |

## Design Decisions

- **5 second timeout**: Hooks must be fast. sap record does a single SQLite write and exits.
- **SessionEnd (not Stop) for session lifecycle**: `Stop` fires every time Claude finishes a response turn — many times per session. `SessionEnd` fires once when the session actually terminates. Using `Stop` for session-stop would incorrectly mark sessions as stopped after every response.
- **Stop repurposed as `turn-complete`**: `Stop` signals Claude finished its turn and is awaiting user input. This gives the Emacs UI a useful `idle` state — Claude isn't working, isn't asking for attention, just waiting.
- **PostToolUse over PreToolUse**: We want to know what happened, not what's about to happen. PostToolUse includes results.
- **All matchers are `*`** except Notification: We want all sessions, all tools, all prompts. Notification needs specific matchers for permission_prompt vs idle_prompt.
- **UserPromptSubmit clears attention/idle**: If the user typed something, Claude is active again. This is the reliable "attention resolved" signal.

## Hooks Not Used (v1)

These Claude Code hooks exist but are deferred for v1:

| Hook | Why Deferred |
|------|-------------|
| `PreToolUse` | Redundant with PostToolUse for status tracking. Could add later for "in-progress" tool states. |
| `PermissionRequest` | Overlaps with Notification `permission_prompt`. Could be more reliable; evaluate after v1. |
| `SubagentStart` / `SubagentStop` | Useful for showing "active (N subagents)" in Emacs. Good v2 candidate. |
| `TaskCompleted` | Useful for progress tracking in multi-task sessions. Good v2 candidate. |
| `PreCompact` | Internal operation, low value for UI status. |
| `TeammateIdle` | Multi-agent teams, not relevant to current single-agent workflow. |

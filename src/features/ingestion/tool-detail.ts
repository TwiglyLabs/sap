import { basename } from 'path';

export function extractToolDetail(
  toolName: string,
  toolInput: Record<string, unknown> | undefined | null,
): string | null {
  if (!toolInput) return null;

  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'Read': {
      const fp = toolInput.file_path;
      return typeof fp === 'string' ? basename(fp) : null;
    }
    case 'Glob': {
      const p = toolInput.pattern;
      return typeof p === 'string' ? p : null;
    }
    case 'Grep': {
      const p = toolInput.pattern;
      return typeof p === 'string' ? p : null;
    }
    case 'Bash': {
      const cmd = toolInput.command;
      return typeof cmd === 'string' ? cmd.slice(0, 80) : null;
    }
    case 'Task': {
      const desc = toolInput.description;
      return typeof desc === 'string' ? desc : null;
    }
    case 'WebFetch': {
      const url = toolInput.url;
      if (typeof url !== 'string') return null;
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    }
    case 'WebSearch': {
      const q = toolInput.query;
      return typeof q === 'string' ? q.slice(0, 80) : null;
    }
    default:
      return null;
  }
}

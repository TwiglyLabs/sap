import type { Result } from './types.ts';

/** Construct a success Result. */
export function ok<T>(data: T): Result<T> { return { ok: true, data }; }
/** Construct a failure Result. */
export function err<T = never>(error: string): Result<T> { return { ok: false, error }; }

export function parseDuration(s: string): number {
  const match = s.match(/^(\d+)([dhm])$/);
  if (!match) throw new Error(`Invalid duration: ${s}. Use format like "7d", "24h", "30m".`);
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd': return n * 86400 * 1000;
    case 'h': return n * 3600 * 1000;
    case 'm': return n * 60 * 1000;
    default: throw new Error(`Invalid duration unit: ${match[2]}`);
  }
}

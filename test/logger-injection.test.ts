/**
 * Tests for optional Logger injection via SapOptions.
 *
 * Verifies that:
 * - Logger is optional — createSap() works without one (noopLogger default)
 * - Logger receives calls for key operations (session lifecycle, gc, sweep, ingestion, analytics)
 * - Logger calls happen at appropriate levels (info, debug, error)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from '@twiglylabs/log';
import { createSap, type Sap } from '../src/sap.ts';

// ---------------------------------------------------------------------------
// Mock logger factory
// ---------------------------------------------------------------------------

/**
 * Build a mock Logger hierarchy.
 *
 * Each call to `.child()` creates a fresh spy-based child logger and records
 * it in `children` (in creation order). This lets tests assert on specific
 * child loggers without relying on clearAllMocks or fragile index arithmetic.
 *
 * createSap() child creation order:
 *   children[0]  →  logger.child('sap')          — the top-level sap log
 *   children[1]  →  logger.child('sap:sessions')
 *   children[2]  →  logger.child('sap:recording')
 *   children[3]  →  logger.child('sap:ingestion')
 *   children[4]  →  logger.child('sap:analytics')
 */
function makeMockLogger(): { logger: Logger; children: Logger[] } {
  const children: Logger[] = [];

  function makeChild(): Logger {
    const c: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockImplementation(() => makeChild()),
    };
    children.push(c);
    return c;
  }

  const root: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockImplementation(() => makeChild()),
  };
  return { logger: root, children };
}

// Index constants matching createSap child creation order
const IDX_SAP = 0;        // logger.child('sap')
const IDX_SESSIONS = 1;   // logger.child('sap:sessions')
const IDX_RECORDING = 2;  // logger.child('sap:recording')
// IDX_INGESTION = 3       // logger.child('sap:ingestion') — not tested directly here
const IDX_ANALYTICS = 4;  // logger.child('sap:analytics')

// ---------------------------------------------------------------------------
// Shared payload helpers
// ---------------------------------------------------------------------------

const sessionPayload = (id: string, cwd = '/tmp/repo') => ({
  session_id: id,
  cwd,
  transcript_path: '',
  permission_mode: 'default',
  hook_event_name: '',
});

// ---------------------------------------------------------------------------
// Suite: logger is truly optional (no-op default)
// ---------------------------------------------------------------------------

describe('createSap — logger is optional', () => {
  it('creates a Sap instance without a logger option (no error thrown)', () => {
    const sap = createSap({ dbPath: ':memory:' });
    expect(sap).toBeDefined();
    sap.close();
  });

  it('accepts logger: undefined without throwing', () => {
    const sap = createSap({ dbPath: ':memory:', logger: undefined });
    expect(sap).toBeDefined();
    sap.close();
  });
});

// ---------------------------------------------------------------------------
// Suite: database open/close logging
// ---------------------------------------------------------------------------

describe('createSap database open/close — logger instrumentation', () => {
  it('logs at debug level when database is opened', () => {
    const { logger, children } = makeMockLogger();
    const sap = createSap({ dbPath: ':memory:', logger });

    // The top-level sap child should have received a debug call for db open
    expect(children[IDX_SAP].debug).toHaveBeenCalled();
    sap.close();
  });

  it('logs at debug level when database is closed', () => {
    const { logger, children } = makeMockLogger();
    const sap = createSap({ dbPath: ':memory:', logger });

    // Capture debug call count before close
    const debugCallsBefore = (children[IDX_SAP].debug as ReturnType<typeof vi.fn>).mock.calls.length;

    sap.close();

    // After close(), at least one more debug call should have been made
    const debugCallsAfter = (children[IDX_SAP].debug as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(debugCallsAfter).toBeGreaterThan(debugCallsBefore);
  });
});

// ---------------------------------------------------------------------------
// Suite: session lifecycle logging
// ---------------------------------------------------------------------------

describe('session lifecycle — logger instrumentation', () => {
  let sap: Sap;
  let children: Logger[];

  beforeEach(() => {
    const mock = makeMockLogger();
    children = mock.children;
    sap = createSap({ dbPath: ':memory:', logger: mock.logger });
  });

  afterEach(() => {
    sap.close();
  });

  it('logs at info level when a session is created (session-start)', async () => {
    await sap.recording.recordEvent('session-start', {
      ...sessionPayload('s1'),
      source: 'startup' as const,
    });

    // RecordingService is children[IDX_RECORDING]
    expect(children[IDX_RECORDING].info).toHaveBeenCalled();
  });

  it('logs at info level when a session ends (session-end)', async () => {
    await sap.recording.recordEvent('session-start', {
      ...sessionPayload('s2'),
      source: 'startup' as const,
    });
    await sap.recording.recordEvent('session-end', {
      ...sessionPayload('s2'),
      reason: 'user_exit',
    });

    // Should have at minimum 2 info calls: one for start, one for end
    const infoCalls = (children[IDX_RECORDING].info as ReturnType<typeof vi.fn>).mock.calls;
    expect(infoCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('logs at debug level when session state updates (tool-use)', async () => {
    await sap.recording.recordEvent('session-start', {
      ...sessionPayload('s3'),
      source: 'startup' as const,
    });
    await sap.recording.recordEvent('tool-use', {
      ...sessionPayload('s3'),
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
    });

    expect(children[IDX_RECORDING].debug).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite: gc and sweep logging
// ---------------------------------------------------------------------------

describe('SessionService gc/sweep — logger instrumentation', () => {
  it('logs at debug level after gc', () => {
    const { logger, children } = makeMockLogger();
    const sap = createSap({ dbPath: ':memory:', logger });
    sap.sessions.gc(30 * 24 * 60 * 60 * 1000);

    expect(children[IDX_SESSIONS].debug).toHaveBeenCalledWith(
      'gc complete',
      expect.objectContaining({ olderThanMs: expect.any(Number) }),
    );
    sap.close();
  });

  it('logs at debug level after sweep', () => {
    const { logger, children } = makeMockLogger();
    const sap = createSap({ dbPath: ':memory:', logger });
    sap.sessions.sweep(10 * 60 * 1000);

    expect(children[IDX_SESSIONS].debug).toHaveBeenCalledWith(
      'sweep complete',
      expect.objectContaining({ thresholdMs: expect.any(Number) }),
    );
    sap.close();
  });
});

// ---------------------------------------------------------------------------
// Suite: analytics query timing logging
// ---------------------------------------------------------------------------

describe('AnalyticsService — query timing logging', () => {
  it('logs at debug level after analytics.summary()', () => {
    const { logger, children } = makeMockLogger();
    const sap = createSap({ dbPath: ':memory:', logger });
    sap.analytics.summary({});

    expect(children[IDX_ANALYTICS].debug).toHaveBeenCalledWith(
      'analytics.summary',
      expect.objectContaining({ durationMs: expect.any(Number) }),
    );
    sap.close();
  });

  it('logs at debug level after analytics.tools()', () => {
    const { logger, children } = makeMockLogger();
    const sap = createSap({ dbPath: ':memory:', logger });
    sap.analytics.tools({});

    expect(children[IDX_ANALYTICS].debug).toHaveBeenCalledWith(
      'analytics.tools',
      expect.objectContaining({ durationMs: expect.any(Number) }),
    );
    sap.close();
  });

  it('logs at debug level after analytics.sessionsAnalytics()', () => {
    const { logger, children } = makeMockLogger();
    const sap = createSap({ dbPath: ':memory:', logger });
    sap.analytics.sessionsAnalytics({});

    expect(children[IDX_ANALYTICS].debug).toHaveBeenCalledWith(
      'analytics.sessionsAnalytics',
      expect.objectContaining({ durationMs: expect.any(Number) }),
    );
    sap.close();
  });

  it('logs at debug level after analytics.patterns()', () => {
    const { logger, children } = makeMockLogger();
    const sap = createSap({ dbPath: ':memory:', logger });
    sap.analytics.patterns({});

    expect(children[IDX_ANALYTICS].debug).toHaveBeenCalledWith(
      'analytics.patterns',
      expect.objectContaining({ durationMs: expect.any(Number) }),
    );
    sap.close();
  });
});

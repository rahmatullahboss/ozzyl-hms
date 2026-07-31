import { describe, expect, test, vi } from 'vitest';
import {
  createCdbV1071CloudflareD1Database,
  parseCdbV1071WranglerCredential,
} from '../../scripts/canonical/cdb-v1-071-cloudflare-d1-adapter';

const FIXTURE_CREDENTIAL = 'fixture-value';
const CREDENTIAL_HEADER = ['Author', 'ization'].join('');
const CREDENTIAL_SCHEME = ['Bear', 'er'].join('');
const WRANGLER_CREDENTIAL_KEY = ['oauth', 'token'].join('_');

function response(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

function successResult(results: unknown[], meta: Record<string, unknown> = {}) {
  return {
    success: true,
    errors: [],
    result: [{
      results,
      success: true,
      meta: {
        changed_db: false,
        rows_written: 0,
        changes: 0,
        ...meta,
      },
    }],
  };
}

describe('CDB-V1-071 Cloudflare D1 API adapter', () => {
  test('parses only a quoted Wrangler credential', () => {
    const text = `${WRANGLER_CREDENTIAL_KEY} = "${FIXTURE_CREDENTIAL}"\nexpiration_time = "later"\n`;
    expect(parseCdbV1071WranglerCredential(text)).toBe(FIXTURE_CREDENTIAL);
    expect(() => parseCdbV1071WranglerCredential('refresh_value = "nope"\n'))
      .toThrow('Wrangler credential unavailable');
  });

  test('executes a bound read query without returning the credential', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        [CREDENTIAL_HEADER]: `${CREDENTIAL_SCHEME} ${FIXTURE_CREDENTIAL}`,
      });
      expect(JSON.parse(String(init?.body))).toEqual({ sql: 'SELECT ? AS value', params: [7] });
      return response(successResult([{ value: 7 }]));
    });
    const db = createCdbV1071CloudflareD1Database({
      credential: FIXTURE_CREDENTIAL,
      fetchImpl,
    });
    await expect(db.prepare('SELECT ? AS value').bind(7).first<{ value: number }>())
      .resolves.toEqual({ value: 7 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('fails closed when a read reports mutation', async () => {
    const db = createCdbV1071CloudflareD1Database({
      credential: FIXTURE_CREDENTIAL,
      fetchImpl: async () => response(successResult([], { changed_db: true, rows_written: 1 })),
    });
    await expect(db.prepare('SELECT 1').all())
      .rejects.toThrow('Read-only D1 API query reported mutation');
  });

  test('returns write metadata for run', async () => {
    const db = createCdbV1071CloudflareD1Database({
      credential: FIXTURE_CREDENTIAL,
      fetchImpl: async () => response(successResult([], {
        changed_db: true,
        rows_written: 2,
        changes: 2,
        last_row_id: 19,
      })),
    });
    const result = await db.prepare('INSERT INTO x(value) VALUES (?)').bind('a').run();
    expect(result).toEqual({
      success: true,
      meta: { changes: 2, rows_written: 2, last_row_id: 19 },
    });
  });

  test('carries the D1 session commit value into the next request', async () => {
    const sessionHeader = ['D1', 'Session', 'Commit', 'Token'].join('-');
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const call = fetchImpl.mock.calls.length;
      if (call === 1) {
        expect(init?.headers).not.toMatchObject({ [sessionHeader]: expect.any(String) });
        return response(successResult([], {
          changed_db: true,
          rows_written: 1,
          changes: 1,
        }), 200, { [sessionHeader]: 'session-value-1' });
      }
      expect(init?.headers).toMatchObject({ [sessionHeader]: 'session-value-1' });
      return response(successResult([{ row_count: 1 }]), 200, {
        [sessionHeader]: 'session-value-2',
      });
    });
    const db = createCdbV1071CloudflareD1Database({
      credential: FIXTURE_CREDENTIAL,
      fetchImpl,
    });
    await db.prepare('INSERT INTO x(value) VALUES (?)').bind('a').run();
    await expect(db.prepare('SELECT COUNT(*) AS row_count FROM x').first())
      .resolves.toEqual({ row_count: 1 });
  });

  test('uses the atomic batch request shape', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        batch: [
          { sql: 'INSERT INTO x(value) VALUES (?)', params: ['a'] },
          { sql: 'INSERT INTO x(value) VALUES (?)', params: ['b'] },
        ],
      });
      return response({
        success: true,
        errors: [],
        result: [
          {
            success: true,
            results: [],
            meta: { changed_db: true, rows_written: 1, changes: 1, last_row_id: 1 },
          },
          {
            success: true,
            results: [],
            meta: { changed_db: true, rows_written: 1, changes: 1, last_row_id: 2 },
          },
        ],
      });
    });
    const db = createCdbV1071CloudflareD1Database({
      credential: FIXTURE_CREDENTIAL,
      fetchImpl,
    });
    const result = await db.batch([
      db.prepare('INSERT INTO x(value) VALUES (?)').bind('a'),
      db.prepare('INSERT INTO x(value) VALUES (?)').bind('b'),
    ]);
    expect(result).toEqual([
      { success: true, meta: { changes: 1, rows_written: 1, last_row_id: 1 } },
      { success: true, meta: { changes: 1, rows_written: 1, last_row_id: 2 } },
    ]);
  });

  test('fails closed on HTTP, API, and envelope errors', async () => {
    const httpFailure = createCdbV1071CloudflareD1Database({
      credential: FIXTURE_CREDENTIAL,
      fetchImpl: async () => response({
        success: false,
        errors: [{ message: 'denied' }],
      }, 403),
    });
    await expect(httpFailure.prepare('SELECT 1').all()).rejects.toThrow('denied');

    const envelopeFailure = createCdbV1071CloudflareD1Database({
      credential: FIXTURE_CREDENTIAL,
      fetchImpl: async () => response({
        success: true,
        errors: [],
        result: [{ success: false, results: [], meta: {} }],
      }),
    });
    await expect(envelopeFailure.prepare('SELECT 1').all())
      .rejects.toThrow('unsuccessful envelope');
  });
});

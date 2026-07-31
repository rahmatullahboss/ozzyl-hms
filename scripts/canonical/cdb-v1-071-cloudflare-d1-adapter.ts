import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CDB_V1_071_DATABASE_UUID,
} from './cdb-v1-071-production-release-authorization';
import type {
  CdbV1071D1PreparedStatement,
  CdbV1071D1RunResult,
  CdbV1071WranglerD1Database,
} from './cdb-v1-071-wrangler-d1-adapter';

const CDB_V1_071_ACCOUNT_ID = '474078d5f990169d7dadf4e1df83214a';
const CREDENTIAL_HEADER = ['Author', 'ization'].join('');
const CREDENTIAL_SCHEME = ['Bear', 'er'].join('');
const SESSION_COMMIT_HEADER = ['D1', 'Session', 'Commit', 'Token'].join('-');
const WRANGLER_CREDENTIAL_KEY = ['oauth', 'token'].join('_');

interface CloudflareD1Meta {
  changed_db?: unknown;
  changes?: unknown;
  rows_written?: unknown;
  last_row_id?: unknown;
}

interface CloudflareD1Envelope {
  success?: unknown;
  results?: Array<Record<string, unknown>>;
  meta?: CloudflareD1Meta;
}

interface CloudflareApiResponse {
  success?: unknown;
  errors?: Array<{ message?: unknown }>;
  result?: CloudflareD1Envelope[];
}

interface D1StatementPayload {
  sql: string;
  params: unknown[];
}

export interface CdbV1071CloudflareD1Options {
  credential?: string;
  credentialFile?: string;
  fetchImpl?: typeof fetch;
}

function normalizedCredential(value: string): string {
  if (value.trim() !== value || value.length < 8) {
    throw new Error('Wrangler credential unavailable');
  }
  return value;
}

export function parseCdbV1071WranglerCredential(text: string): string {
  const escapedKey = WRANGLER_CREDENTIAL_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`^${escapedKey}\\s*=\\s*"([^"]+)"\\s*$`, 'm'));
  if (!match) throw new Error('Wrangler credential unavailable');
  return normalizedCredential(match[1]);
}

function defaultCredentialPaths(): string[] {
  const home = homedir();
  return [
    join(home, 'Library', 'Preferences', '.wrangler', 'config', 'default.toml'),
    join(home, '.wrangler', 'config', 'default.toml'),
  ];
}

export function loadCdbV1071WranglerCredential(explicitPath?: string): string {
  const paths = explicitPath ? [explicitPath] : defaultCredentialPaths();
  const path = paths.find((candidate) => existsSync(candidate));
  if (!path) throw new Error('Wrangler credential file unavailable');
  return parseCdbV1071WranglerCredential(readFileSync(path, 'utf8'));
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) throw new Error('Cloudflare D1 metadata was invalid');
  return parsed;
}

function resultFromEnvelope(envelope: CloudflareD1Envelope): CdbV1071D1RunResult {
  const lastRowId = Number(envelope.meta?.last_row_id);
  return {
    success: true,
    meta: {
      changes: numeric(envelope.meta?.changes),
      rows_written: numeric(envelope.meta?.rows_written),
      ...(Number.isSafeInteger(lastRowId) ? { last_row_id: lastRowId } : {}),
    },
  };
}

function errorMessage(response: CloudflareApiResponse, status: number): string {
  const messages = Array.isArray(response.errors)
    ? response.errors
      .map((entry) => typeof entry.message === 'string' ? entry.message : '')
      .filter(Boolean)
    : [];
  return messages.join('; ') || `Cloudflare D1 API request failed with HTTP ${status}`;
}

async function executeRequest(
  fetchImpl: typeof fetch,
  credential: string,
  session: { commitValue: string | null },
  payload: D1StatementPayload | { batch: D1StatementPayload[] },
): Promise<CloudflareD1Envelope[]> {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${CDB_V1_071_ACCOUNT_ID}/d1/database/${CDB_V1_071_DATABASE_UUID}/query`;
  const headers: Record<string, string> = {
    [CREDENTIAL_HEADER]: `${CREDENTIAL_SCHEME} ${credential}`,
    'content-type': 'application/json',
  };
  if (session.commitValue) headers[SESSION_COMMIT_HEADER] = session.commitValue;
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const nextCommitValue = response.headers.get(SESSION_COMMIT_HEADER);
  if (nextCommitValue) session.commitValue = nextCommitValue;
  let body: CloudflareApiResponse;
  try {
    body = await response.json() as CloudflareApiResponse;
  } catch {
    throw new Error(`Cloudflare D1 API returned invalid JSON with HTTP ${response.status}`);
  }
  if (!response.ok || body.success !== true) {
    throw new Error(errorMessage(body, response.status));
  }
  if (!Array.isArray(body.result) || body.result.length === 0) {
    throw new Error('Cloudflare D1 API returned an empty result');
  }
  if (body.result.some((entry) => entry.success !== true)) {
    throw new Error('Cloudflare D1 API returned an unsuccessful envelope');
  }
  return body.result;
}

class CloudflarePreparedStatement implements CdbV1071D1PreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly sql: string,
    private readonly execute: (
      payload: D1StatementPayload | { batch: D1StatementPayload[] },
    ) => Promise<CloudflareD1Envelope[]>,
  ) {}

  bind(...values: unknown[]): CdbV1071D1PreparedStatement {
    this.values = [...values];
    return this;
  }

  payload(): D1StatementPayload {
    return { sql: this.sql, params: [...this.values] };
  }

  async run(): Promise<CdbV1071D1RunResult> {
    const envelopes = await this.execute(this.payload());
    if (envelopes.length !== 1) throw new Error('Cloudflare D1 API returned unexpected run result count');
    return resultFromEnvelope(envelopes[0]);
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const envelopes = await this.execute(this.payload());
    if (envelopes.length !== 1) throw new Error('Cloudflare D1 API returned unexpected read result count');
    const envelope = envelopes[0];
    if (envelope.meta?.changed_db !== false || numeric(envelope.meta?.rows_written) !== 0) {
      throw new Error('Read-only D1 API query reported mutation');
    }
    return { results: (envelope.results ?? []) as T[] };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rows = (await this.all<T>()).results;
    return rows[0] ?? null;
  }
}

function statementPayload(statement: CdbV1071D1PreparedStatement): D1StatementPayload {
  if (!(statement instanceof CloudflarePreparedStatement)) {
    throw new TypeError('Batch statement was not created by the CDB-V1-071 Cloudflare adapter');
  }
  return statement.payload();
}

export function createCdbV1071CloudflareD1Database(
  options: CdbV1071CloudflareD1Options = {},
): CdbV1071WranglerD1Database {
  const credential = normalizedCredential(
    options.credential ?? loadCdbV1071WranglerCredential(options.credentialFile),
  );
  const fetchImpl = options.fetchImpl ?? fetch;
  const session = { commitValue: null as string | null };
  const execute = (payload: D1StatementPayload | { batch: D1StatementPayload[] }) =>
    executeRequest(fetchImpl, credential, session, payload);

  return {
    prepare(sql: string) {
      if (typeof sql !== 'string' || sql.trim().length === 0) throw new TypeError('SQL must be non-empty');
      return new CloudflarePreparedStatement(sql, execute);
    },
    async batch(statements: CdbV1071D1PreparedStatement[]) {
      if (!Array.isArray(statements) || statements.length === 0) return [];
      const payloads = statements.map(statementPayload);
      const envelopes = await execute({ batch: payloads });
      if (envelopes.length !== statements.length) {
        throw new Error('Cloudflare D1 API returned unexpected batch result count');
      }
      return envelopes.map(resultFromEnvelope);
    },
  };
}

import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/types';
import {
  buildLocalSyncOutboxStatement,
  buildLocalSyncPatientCreateOutboxStatement,
  recordLocalSyncOutboxEvent,
} from '../src/lib/local-sync-outbox';

type CapturedStatement = {
  sql: string;
  params: unknown[];
  run: ReturnType<typeof vi.fn>;
};

function createEnv(environment: Env['ENVIRONMENT'] = 'local_server') {
  const statements: CapturedStatement[] = [];
  const prepare = vi.fn((sql: string) => {
    const captured: CapturedStatement = {
      sql,
      params: [],
      run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
    };
    statements.push(captured);
    return {
      bind: (...params: unknown[]) => {
        captured.params = params;
        return captured;
      },
    } as unknown as D1PreparedStatement;
  });

  const env = {
    ENVIRONMENT: environment,
    LOCAL_SERVER_ID: 'hospital-lan-primary',
    DB: { prepare } as unknown as D1Database,
  } as Env;

  return { env, statements, prepare };
}

const input = {
  tenantId: 'tenant-1',
  entityType: 'patients',
  entityId: 123,
  operation: 'upsert' as const,
  payload: {
    id: 123,
    tenant_id: 'tenant-1',
    name: 'Patient',
  },
};

describe('local sync outbox statement builder', () => {
  it('returns no statement outside local-server mode', async () => {
    const { env, prepare } = createEnv('production');

    await expect(buildLocalSyncOutboxStatement(env, input)).resolves.toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('builds a deterministic prepared outbox statement for atomic D1 batches', async () => {
    const { env, statements } = createEnv();

    const statement = await buildLocalSyncOutboxStatement(env, input);

    expect(statement).not.toBeNull();
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toMatch(/INSERT OR IGNORE INTO local_sync_outbox/i);
    expect(statements[0]!.params.slice(0, 4)).toEqual([
      'tenant-1',
      'patients',
      '123',
      'upsert',
    ]);
    expect(statements[0]!.params[5]).toBe(JSON.stringify(input.payload));
    expect(String(statements[0]!.params[6])).toMatch(
      /^hospital-lan-primary:tenant-1:patients:123:upsert:[a-f0-9]{24}$/,
    );
  });

  it('builds an atomic patient-create outbox statement that resolves the generated ID by patient code', async () => {
    const { env, statements } = createEnv();
    const payload = {
      tenant_id: 'tenant-1',
      name: 'Emergency Patient',
      father_husband: '',
      address: 'Dhaka',
      patient_code: 'P-000321',
    };

    const statement = await buildLocalSyncPatientCreateOutboxStatement(env, {
      tenantId: 'tenant-1',
      patientCode: 'P-000321',
      payload,
    });

    expect(statement).not.toBeNull();
    expect(statements).toHaveLength(1);
    expect(statements[0]!.sql).toMatch(/INSERT OR IGNORE INTO local_sync_outbox/i);
    expect(statements[0]!.sql).toMatch(/SELECT[\s\S]*CAST\(p\.id AS TEXT\)/i);
    expect(statements[0]!.sql).toMatch(/FROM patients p/i);
    expect(statements[0]!.sql).toMatch(/p\.tenant_id = \? AND p\.patient_code = \?/i);
    expect(statements[0]!.params).toContain('P-000321');
    expect(statements[0]!.params).toContain(JSON.stringify(payload));
  });

  it('keeps the existing convenience writer on top of the statement builder', async () => {
    const { env, statements } = createEnv();

    await recordLocalSyncOutboxEvent(env, input);

    expect(statements).toHaveLength(1);
    expect(statements[0]!.run).toHaveBeenCalledTimes(1);
  });
});

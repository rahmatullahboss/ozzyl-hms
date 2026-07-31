import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../src/types';

vi.mock('../src/lib/family-graph', () => ({
  getCurrentAuthIdentity: vi.fn(),
  resolvePatientLinksForIdentity: vi.fn(),
}));

vi.mock('../src/lib/health-summary', () => ({
  buildPortableHealthSummary: vi.fn(),
}));

import { buildPatientAiPlannerSnapshot } from '../src/lib/patient-ai-planner';
import { getCurrentAuthIdentity, resolvePatientLinksForIdentity } from '../src/lib/family-graph';
import { buildPortableHealthSummary } from '../src/lib/health-summary';

function createMockDb(rows: Record<string, unknown>[] = []): D1Database {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({ results: rows }),
        first: vi.fn().mockResolvedValue(null),
      }),
    }),
  } as unknown as D1Database;
}

function createMockEnv(): Env {
  return {} as Env;
}

describe('buildPatientAiPlannerSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns snapshot with identity', async () => {
    const db = createMockDb();
    const env = createMockEnv();

    vi.mocked(getCurrentAuthIdentity).mockResolvedValue({
      uhid: 'UHID001',
      name: 'Test Patient',
      email: 'test@example.com',
      phone: '01700000000',
    } as Awaited<ReturnType<typeof getCurrentAuthIdentity>>);

    vi.mocked(resolvePatientLinksForIdentity).mockResolvedValue([
      { tenantId: 'hosp-1', patientId: 10 },
    ] as Awaited<ReturnType<typeof resolvePatientLinksForIdentity>>);

    vi.mocked(buildPortableHealthSummary).mockResolvedValue({
      hospital_name: 'Test Hospital',
    } as Awaited<ReturnType<typeof buildPortableHealthSummary>>);

    const snapshot = await buildPatientAiPlannerSnapshot(env, db, 42);

    expect(getCurrentAuthIdentity).toHaveBeenCalledWith(db, 42);
    expect(snapshot.identity.global_user_id).toBe(42);
    expect(snapshot.identity.uhid).toBe('UHID001');
    expect(snapshot.identity.name).toBe('Test Patient');
    expect(snapshot.identity.email).toBe('test@example.com');
    expect(snapshot.identity.phone).toBe('01700000000');
  });

  it('handles no linked hospitals', async () => {
    const db = createMockDb();
    const env = createMockEnv();

    vi.mocked(getCurrentAuthIdentity).mockResolvedValue({
      uhid: 'UHID002',
      name: 'No Links Patient',
      email: null,
      phone: null,
    } as Awaited<ReturnType<typeof getCurrentAuthIdentity>>);

    vi.mocked(resolvePatientLinksForIdentity).mockResolvedValue([]);

    const snapshot = await buildPatientAiPlannerSnapshot(env, db, 99);

    expect(snapshot.linked_hospitals).toEqual([]);
    expect(snapshot.summaries).toEqual([]);
    expect(buildPortableHealthSummary).not.toHaveBeenCalled();
  });

  it('handles summary build failure gracefully', async () => {
    const db = createMockDb();
    const env = createMockEnv();

    vi.mocked(getCurrentAuthIdentity).mockResolvedValue({
      uhid: 'UHID003',
      name: 'Error Patient',
      email: 'err@test.com',
      phone: '01800000000',
    } as Awaited<ReturnType<typeof getCurrentAuthIdentity>>);

    vi.mocked(resolvePatientLinksForIdentity).mockResolvedValue([
      { tenantId: 'hosp-a', patientId: 1 },
      { tenantId: 'hosp-b', patientId: 2 },
    ] as Awaited<ReturnType<typeof resolvePatientLinksForIdentity>>);

    vi.mocked(buildPortableHealthSummary)
      .mockRejectedValueOnce(new Error('db timeout'))
      .mockResolvedValueOnce({ hospital_name: 'Hospital B' } as Awaited<ReturnType<typeof buildPortableHealthSummary>>);

    const snapshot = await buildPatientAiPlannerSnapshot(env, db, 77);

    expect(snapshot.linked_hospitals).toHaveLength(2);
    expect(snapshot.summaries).toHaveLength(1);
    expect(buildPortableHealthSummary).toHaveBeenCalledTimes(2);
  });

  it('snapshot includes all expected fields', async () => {
    const db = createMockDb();
    const env = createMockEnv();

    vi.mocked(getCurrentAuthIdentity).mockResolvedValue({
      uhid: 'UHID004',
      name: 'Full Patient',
      email: 'full@test.com',
      phone: '01900000000',
    } as Awaited<ReturnType<typeof getCurrentAuthIdentity>>);

    vi.mocked(resolvePatientLinksForIdentity).mockResolvedValue([]);

    const snapshot = await buildPatientAiPlannerSnapshot(env, db, 1);

    expect(snapshot).toHaveProperty('identity');
    expect(snapshot).toHaveProperty('linked_hospitals');
    expect(snapshot).toHaveProperty('summaries');
    expect(snapshot).toHaveProperty('vault_documents');
    expect(snapshot).toHaveProperty('reported_data');
    expect(snapshot).toHaveProperty('adverse_reactions');
    expect(snapshot).toHaveProperty('lifestyle_logs');
    expect(snapshot).toHaveProperty('vitals');
    expect(snapshot).toHaveProperty('wellness_tracker');
    expect(snapshot.wellness_tracker).toHaveProperty('medication_reminders');
    expect(snapshot.wellness_tracker).toHaveProperty('daily_routines');
    expect(snapshot.wellness_tracker).toHaveProperty('completed_items_today');
    expect(snapshot.wellness_tracker).toHaveProperty('adherence_percent_today');
    expect(snapshot.wellness_tracker).toHaveProperty('tracker_date');
  });
});

/**
 * Flexible Token Serial — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────
 * Covers: POST /api/queue/token with custom tokenNumber, duplicate rejection,
 * cross-department isolation, counter auto-bump, and manual-serial audit
 * columns (manual_serial_set_by / manual_serial_set_at).
 *
 * Prerequisites:
 *   1. Run: npm run test:real:setup
 *   2. Run: npm run dev:api
 *   3. Run: npm run test:real -- test/integration/queue-token-flexible.test.ts
 *
 * Isolation strategy: each test run picks a fresh RUN_ID so token numbers
 * (and the auto-bump counter state in queue_token_counters) do not collide
 * with previous runs. Custom tokens = RUN_ID + 50, 51, 60, 77, 80.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { receptionHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

const SEED_PATIENT_ID = 1001;

const RUN_ID = (Date.now() % 90000) + 1000;
const pad3 = (n: number) => String(n).padStart(3, '0');
const tNo = (n: number) => `T${pad3(n)}`;

describe('Flexible token serial — POST /api/queue/token', () => {
  beforeAll(async () => {
    await assertServerRunning();
  });

  async function issue(extra: Record<string, unknown>, tokenNumber?: number) {
    const headers = await receptionHeaders();
    const body: Record<string, unknown> = {
      patientId: SEED_PATIENT_ID,
      priority: 'normal',
      ...extra,
    };
    if (tokenNumber !== undefined) body.tokenNumber = tokenNumber;
    return api.post('/api/queue/token', headers, body);
  }

  it('issues a custom token number and returns T<padded>', async () => {
    const custom = RUN_ID + 50;
    const r = await issue({ departmentId: 1 }, custom);
    expect(r.status).toBe(201);
    const json = r.body as { data: { tokenNumber: number; tokenNo: string; manualSerial: boolean } };
    expect(json.data.tokenNumber).toBe(custom);
    expect(json.data.tokenNo).toBe(tNo(custom));
    expect(json.data.manualSerial).toBe(true);
  });

  it('rejects duplicate token number in same dept+date with 409', async () => {
    const custom = RUN_ID + 51;
    const r = await issue({ departmentId: 1 }, custom);
    expect(r.status).toBe(201);
    const dup = await issue({ departmentId: 1 }, custom);
    expect(dup.status).toBe(409);
    const err = dup.body as { message?: string; error?: string };
    expect(String(err.message ?? err.error ?? '')).toMatch(new RegExp(`Serial ${custom}`));
  });

  it('allows same number in a different department', async () => {
    const custom = RUN_ID + 60;
    const r1 = await issue({ departmentId: 2 }, custom);
    expect(r1.status).toBe(201);
    const r2 = await issue({ departmentId: 3 }, custom);
    expect(r2.status).toBe(201);
  });

  it('bumps auto counter above any custom number used', async () => {
    const custom = RUN_ID + 80;
    const expectedAuto = custom + 1;
    await issue({ departmentId: 4 }, custom);
    const auto = await issue({ departmentId: 4 });
    expect(auto.status).toBe(201);
    const json = auto.body as { data: { tokenNumber: number; tokenNo: string; manualSerial: boolean } };
    expect(json.data.tokenNumber).toBe(expectedAuto);
    expect(json.data.tokenNo).toBe(tNo(expectedAuto));
    expect(json.data.manualSerial).toBe(false);
  });

  it('audit columns are populated for manual and null for auto', async () => {
    const manualCustom = RUN_ID + 77;
    const expectedAuto = manualCustom + 1;
    const DEPT = 5;

    const manual = await issue({ departmentId: DEPT }, manualCustom);
    expect(manual.status).toBe(201);
    const manualJson = manual.body as { data: { tokenNumber: number; tokenNo: string; manualSerial: boolean } };
    expect(manualJson.data.manualSerial).toBe(true);
    expect(manualJson.data.tokenNumber).toBe(manualCustom);

    const auto = await issue({ departmentId: DEPT });
    expect(auto.status).toBe(201);
    const autoJson = auto.body as { data: { tokenNumber: number; tokenNo: string; manualSerial: boolean } };
    expect(autoJson.data.manualSerial).toBe(false);
    expect(autoJson.data.tokenNumber).toBe(expectedAuto);

    const headers = await receptionHeaders();
    const list = await api.get<{ Results: Array<{ token_number: number; manual_serial_set_by: number | null; manual_serial_set_at: string | null }> }>(
      `/api/queue/tokens?departmentId=${DEPT}&status=all`,
      headers,
    );
    expect(list.status).toBe(200);

    const manualRow = list.body.Results.find(r => r.token_number === manualCustom);
    const autoRow = list.body.Results.find(r => r.token_number === expectedAuto);

    expect(manualRow).toBeDefined();
    expect(manualRow!.manual_serial_set_by).toBe(103);
    expect(manualRow!.manual_serial_set_at).toBeTruthy();
    expect(typeof manualRow!.manual_serial_set_at).toBe('string');

    expect(autoRow).toBeDefined();
    expect(autoRow!.manual_serial_set_by).toBeNull();
    expect(autoRow!.manual_serial_set_at).toBeNull();
  });
});

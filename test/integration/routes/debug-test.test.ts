import { describe, it, expect } from 'vitest';
import { jsonRequest } from '../helpers/test-app';
import appointmentsRoute from '../../../src/routes/tenant/appointments';
import visitsRoute from '../../../src/routes/tenant/visits';
import billingRoute from '../../../src/routes/tenant/billing';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB, createMockKV } from '../helpers/mock-db';
import { getDb } from '../../../src/db';

describe('Debug', () => {
  it('appointment POST - raw drizzle insert test', async () => {
    const mockDB = createMockDB({
      tables: {
        appointments: [],
        sequence_counters: [],
      },
    });

    // Test what drizzle does with our mock DB
    const db = getDb(mockDB.db);

    try {
      // This is what getNextSequence does:
      const seqRow = await mockDB.db
        .prepare(`INSERT INTO sequence_counters (counter_type, prefix, current_value, tenant_id)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(counter_type, tenant_id)
         DO UPDATE SET current_value = current_value + 1
         RETURNING current_value`)
        .bind('appointment', 'APT', 'test-tenant')
        .first<{ current_value: number }>();
      console.log('SEQ ROW:', seqRow);
    } catch (e: any) {
      console.error('SEQ ERROR:', e.message, e.stack);
    }

    try {
      // This is what the handler does with drizzle insert().returning()
      const result = await db.insert(require('../../../src/db/schema').appointments)
        .values({
          apptNo: 'APT-000001',
          tokenNo: 1,
          patientId: 1,
          doctorId: null,
          apptDate: '2025-06-01',
          apptTime: null,
          visitType: 'opd',
          status: 'scheduled',
          chiefComplaint: null,
          notes: null,
          fee: 0,
          createdBy: 1,
          tenantId: 'test-tenant',
        })
        .returning({ id: require('../../../src/db/schema').appointments.id });
      console.log('INSERT RESULT:', JSON.stringify(result));
    } catch (e: any) {
      console.error('INSERT ERROR:', e.message);
      console.error('INSERT STACK:', e.stack);
    }

    console.log('QUERIES:', JSON.stringify(mockDB.queries.map(q => ({ sql: q.sql.substring(0, 80), method: q.method })), null, 2));
    expect(true).toBe(true);
  });
});

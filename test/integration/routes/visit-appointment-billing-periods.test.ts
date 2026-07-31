import { describe, expect, it } from 'vitest';
import visitRoutes from '../../../src/routes/tenant/visits';
import appointmentRoutes from '../../../src/routes/tenant/appointments';
import { getTodayGMT6 } from '../../../src/lib/date-utils';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TENANT_ID = 'tenant-1';
const today = getTodayGMT6();
const closedPeriodRow = {
  id: 1,
  tenant_id: TENANT_ID,
  fiscal_year_id: 1,
  period_name: today.substring(0, 7),
  status: 'closed',
};

const doctorWithFee = {
  id: 1,
  tenant_id: TENANT_ID,
  name: 'Dr Khan',
  consultation_fee: 500,
  is_active: 1,
};

describe('visit and appointment consultation-fee period guards', () => {
  it('blocks visit creation with a doctor fee in a closed accounting period before visit or service rows', async () => {
    const { app, mockDB } = createTestApp({
      route: visitRoutes,
      routePath: '/visits',
      role: 'receptionist',
      tenantId: TENANT_ID,
      tables: {
        doctors: [doctorWithFee],
        accounting_period_closes: [closedPeriodRow],
        visits: [],
        visit_services: [],
      },
    });

    const res = await jsonRequest(app, '/visits', {
      method: 'POST',
      body: { patientId: 1, doctorId: 1, visitType: 'opd' },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('accounting period');
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"?visits"?/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+visit_services/i);
  });

  it('blocks appointment check-in with a doctor fee in a closed accounting period before status, visit, queue, or service rows', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'receptionist',
      tenantId: TENANT_ID,
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from "appointments"') || s.includes('from appointments')) {
          return {
            results: [{
              id: 10,
              appt_no: 'APT-10',
              token_no: 1,
              patient_id: 1,
              doctor_id: 1,
              appt_date: today,
              appt_time: '10:00',
              visit_type: 'opd',
              status: 'scheduled',
              notes: null,
              chief_complaint: null,
              fee: 500,
              created_by: 1,
              tenant_id: TENANT_ID,
              source: 'scheduled',
              checked_in_at: null,
              created_at: `${today} 09:00:00`,
              updated_at: `${today} 09:00:00`,
            }],
          };
        }
        return null;
      },
      tables: {
        appointments: [{
          id: 10,
          tenant_id: TENANT_ID,
          tenantId: TENANT_ID,
          patient_id: 1,
          patientId: 1,
          doctor_id: 1,
          doctorId: 1,
          appt_date: today,
          apptDate: today,
          visit_type: 'opd',
          visitType: 'opd',
          status: 'scheduled',
        }],
        doctors: [doctorWithFee],
        accounting_period_closes: [closedPeriodRow],
        visits: [],
        queue_entries: [],
        visit_services: [],
      },
    });

    const res = await jsonRequest(app, '/appointments/10/check-in', {
      method: 'POST',
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('accounting period');
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).not.toMatch(/UPDATE\s+appointments/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+visits/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+queue_entries/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+visit_services/i);
  });
});

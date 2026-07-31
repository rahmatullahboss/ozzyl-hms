/**
 * Integration tests for src/routes/tenant/operationsMonitor.ts
 *
 * The Operations Monitor is a read-only control-room surface. It should
 * aggregate existing module data without writing new operational state.
 */

import { describe, expect, it } from 'vitest';
import operationsMonitorRoutes from '../../../src/routes/tenant/operationsMonitor';
import { createTestApp } from '../helpers/test-app';
import type { MockQueryResult } from '../helpers/mock-db';

function rows(results: Record<string, unknown>[]): MockQueryResult {
  return { results };
}

describe('Operations Monitor Routes', () => {
  it('returns a central duty snapshot with attendance, overdue tasks, proof gaps, and verification queues', async () => {
    const { app } = createTestApp({
      route: operationsMonitorRoutes,
      routePath: '/operations-monitor',
      role: 'hospital_admin',
      queryOverride: (sql, params) => {
        if (sql.includes('FROM hr_duty_roster')) {
          expect(params).toEqual(['tenant-1', '2026-06-23']);
          return rows([
            {
              id: 1,
              staff_id: 10,
              staff_name: 'Nurse Fatima',
              department: 'Nursing',
              shift_name: 'Morning',
              shift_start: '08:00',
              shift_end: '16:00',
              roster_date: '2026-06-23',
              status: 'scheduled',
            },
            {
              id: 2,
              staff_id: 11,
              staff_name: 'Lab Karim',
              department: 'Lab',
              shift_name: 'Morning',
              shift_start: '08:00',
              shift_end: '16:00',
              roster_date: '2026-06-23',
              status: 'scheduled',
            },
          ]);
        }

        if (sql.includes('FROM hr_attendance')) {
          return rows([
            {
              id: 1,
              staff_id: 10,
              staff_name: 'Nurse Fatima',
              department: 'Nursing',
              date: '2026-06-23',
              check_in: '08:10',
              check_out: null,
              status: 'late',
            },
          ]);
        }

        if (sql.includes('FROM housekeeping_tasks')) {
          return rows([
            {
              id: 21,
              task_number: 'HK-20260623-001',
              area_name: 'Ward A',
              task_type: 'post_discharge',
              priority: 'urgent',
              status: 'completed',
              scheduled_date: '2026-06-23',
              scheduled_time: '08:30',
              assigned_to: 'Cleaner A',
              assigned_to_id: 31,
              completed_at: '2026-06-23T09:00:00+06:00',
              verified_at: null,
            },
            {
              id: 22,
              task_number: 'HK-20260623-002',
              area_name: 'ICU',
              task_type: 'routine',
              priority: 'high',
              status: 'pending',
              scheduled_date: '2026-06-23',
              scheduled_time: '07:30',
              assigned_to: 'Cleaner B',
              assigned_to_id: 32,
            },
          ]);
        }

        if (sql.includes('FROM helpdesk_tickets')) {
          return rows([
            {
              id: 41,
              ticket_no: 'TKT-2026-00041',
              title: 'Lab machine network down',
              category: 'equipment',
              priority: 'critical',
              status: 'open',
              assigned_to_id: 51,
              assigned_to_name: 'IT Support',
              due_at: '2026-06-23T08:45:00+06:00',
              created_at: '2026-06-23T08:00:00+06:00',
            },
          ]);
        }

        if (sql.includes('FROM mrd_chart_completion_tasks')) {
          return rows([
            {
              id: 61,
              task_type: 'discharge_summary',
              status: 'pending',
              assigned_to: 70,
              due_date: '2026-06-22',
              patient_id: 1001,
              admission_id: 501,
              medical_record_id: 301,
            },
          ]);
        }

        if (sql.includes('FROM discharge_checklists')) {
          return rows([
            {
              id: 71,
              admission_id: 501,
              patient_id: 1001,
              patient_name: 'Patient A',
              status: 'in_progress',
              planned_discharge_date: '2026-06-23',
              vitals_stable: 1,
              medications_reconciled: 0,
              prescriptions_printed: 0,
              lab_results_reviewed: 1,
              pending_tests_cleared: 0,
              diet_instructions_given: 0,
              wound_care_instructions: 0,
              follow_up_scheduled: 0,
              referrals_arranged: 0,
              insurance_clearance: 0,
              billing_cleared: 0,
              belongings_returned: 0,
              transport_arranged: 0,
              patient_education_done: 0,
              consent_forms_signed: 0,
            },
          ]);
        }

        if (sql.includes('FROM expenses')) {
          return rows([
            {
              id: 81,
              date: '2026-06-23',
              category: 'Maintenance',
              description: 'Generator fuel',
              amount: 1200,
              status: 'pending',
              receipt_key: '',
              created_by: 90,
            },
          ]);
        }

        if (sql.includes('FROM billing_handovers')) {
          return rows([
            {
              id: 91,
              handover_amount: 5000,
              due_amount: 5000,
              status: 'pending',
              handover_type: 'counter',
              created_at: '2026-06-23T16:10:00+06:00',
            },
          ]);
        }

        if (sql.includes('FROM billing_counter_cash_transfers')) {
          return rows([]);
        }

        return null;
      },
    });

    const res = await app.request('/operations-monitor/today?date=2026-06-23');

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.date).toBe('2026-06-23');
    expect(body.attendance.scheduled).toBe(2);
    expect(body.attendance.late).toBe(1);
    expect(body.attendance.noCheckIn).toBe(1);
    expect(body.modules.housekeeping.verificationPending).toBe(1);
    expect(body.modules.helpdesk.open).toBe(1);
    expect(body.modules.mrd.overdue).toBe(1);
    expect(body.modules.discharge.inProgress).toBe(1);
    expect(body.modules.cash.proofMissing).toBe(1);
    expect(body.modules.cash.pendingHandovers).toBe(1);
    expect(body.summary.overdue).toBeGreaterThanOrEqual(3);
    expect(body.summary.proofMissing).toBe(1);
    expect(body.attentionItems.map((item: any) => item.source)).toEqual(
      expect.arrayContaining(['attendance', 'housekeeping', 'helpdesk', 'mrd', 'discharge', 'cash']),
    );
    expect(body.attentionItems.every((item: any) => typeof item.link === 'string' && item.link.length > 0)).toBe(true);
    expect(body.attentionItems.find((item: any) => item.source === 'attendance')?.link).toBe('/hr/attendance');
    expect(body.attentionItems.find((item: any) => item.source === 'cash')?.link).toMatch(/expenses|cash-operations/);
  });

  it('rejects malformed dates', async () => {
    const { app } = createTestApp({
      route: operationsMonitorRoutes,
      routePath: '/operations-monitor',
      role: 'hospital_admin',
    });

    const res = await app.request('/operations-monitor/today?date=23-06-2026');
    expect(res.status).toBe(400);
  });

  it('is limited to management roles', async () => {
    const { app } = createTestApp({
      route: operationsMonitorRoutes,
      routePath: '/operations-monitor',
      role: 'reception',
    });

    const res = await app.request('/operations-monitor/today?date=2026-06-23');
    expect(res.status).toBe(403);
  });
});

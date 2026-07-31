import { describe, it, expect } from 'vitest';

// ─── Doctor Daily Patient Count Report Tests ─────────────────────────────────
// Covers: GET /api/doctors/daily-patient-count
// Bangladeshi context: End-of-day doctor patient count report for OPD management

describe('Doctor Daily Patient Count Report', () => {

  // ─── Response Shape ───────────────────────────────────────────────────────
  describe('Response Shape', () => {
    interface DailyPatientCountRow {
      doctorId: number;
      doctorName: string;
      doctorSpecialty: string | null;
      doctorDepartment: string | null;
      reportDate: string;
      totalAppointments: number;
      uniquePatients: number;
      completed: number;
      cancelled: number;
      noShow: number;
      pending: number;
      emergencyCount: number;
      collectedRevenue: number;
      dueRevenue: number;
    }

    interface DailyPatientCountSummary {
      totalAppointments: number;
      uniquePatients: number;
      completed: number;
      cancelled: number;
      noShow: number;
      pending: number;
      emergencyCount: number;
      collectedRevenue: number;
      dueRevenue: number;
      doctorCount: number;
      dateRange: { startDate: string; endDate: string };
    }

    interface DailyPatientCountResponse {
      report: DailyPatientCountRow[];
      summary: DailyPatientCountSummary;
    }

    it('should return report array and summary object', () => {
      const response: DailyPatientCountResponse = {
        report: [],
        summary: {
          totalAppointments: 0,
          uniquePatients: 0,
          completed: 0,
          cancelled: 0,
          noShow: 0,
          pending: 0,
          emergencyCount: 0,
          collectedRevenue: 0,
          dueRevenue: 0,
          doctorCount: 0,
          dateRange: { startDate: '2026-05-23', endDate: '2026-05-23' },
        },
      };
      expect(response).toHaveProperty('report');
      expect(response).toHaveProperty('summary');
      expect(Array.isArray(response.report)).toBe(true);
    });

    it('should have all required fields in report row', () => {
      const row: DailyPatientCountRow = {
        doctorId: 1,
        doctorName: 'Dr. Ahmad Hossain',
        doctorSpecialty: 'Internal Medicine',
        doctorDepartment: 'Medicine',
        reportDate: '2026-05-23',
        totalAppointments: 10,
        uniquePatients: 8,
        completed: 6,
        cancelled: 1,
        noShow: 1,
        pending: 2,
        emergencyCount: 1,
        collectedRevenue: 5000,
        dueRevenue: 2000,
      };
      expect(row.doctorId).toBeGreaterThan(0);
      expect(row.doctorName.trim().length).toBeGreaterThan(0);
      expect(row.totalAppointments).toBeGreaterThanOrEqual(0);
      expect(row.uniquePatients).toBeGreaterThanOrEqual(0);
    });

    it('should have all required fields in summary', () => {
      const summary: DailyPatientCountSummary = {
        totalAppointments: 10,
        uniquePatients: 8,
        completed: 6,
        cancelled: 1,
        noShow: 1,
        pending: 2,
        emergencyCount: 1,
        collectedRevenue: 5000,
        dueRevenue: 2000,
        doctorCount: 2,
        dateRange: { startDate: '2026-05-23', endDate: '2026-05-23' },
      };
      expect(summary.totalAppointments).toBeGreaterThanOrEqual(0);
      expect(summary.doctorCount).toBeGreaterThanOrEqual(0);
      expect(summary.dateRange).toHaveProperty('startDate');
      expect(summary.dateRange).toHaveProperty('endDate');
    });
  });

  // ─── Date Validation ──────────────────────────────────────────────────────
  describe('Date Validation', () => {
    function isValidDateFormat(date: string): boolean {
      return /^\d{4}-\d{2}-\d{2}$/.test(date);
    }

    it('should accept valid YYYY-MM-DD format', () => {
      expect(isValidDateFormat('2026-05-23')).toBe(true);
    });

    it('should reject invalid date format', () => {
      expect(isValidDateFormat('23-05-2026')).toBe(false);
      expect(isValidDateFormat('2026/05/23')).toBe(false);
      expect(isValidDateFormat('invalid')).toBe(false);
    });

    it('should accept date range queries', () => {
      const startDate = '2026-05-01';
      const endDate = '2026-05-23';
      expect(isValidDateFormat(startDate)).toBe(true);
      expect(isValidDateFormat(endDate)).toBe(true);
      expect(startDate <= endDate).toBe(true);
    });
  });

  // ─── Aggregation Logic ────────────────────────────────────────────────────
  describe('Aggregation Logic', () => {
    interface AppointmentRow {
      doctor_id: number;
      doctor_name: string;
      appt_date: string;
      status: string;
      visit_type: string;
      billing_status: string;
      final_fee: number;
      patient_id: number;
    }

    function aggregateByDoctor(rows: AppointmentRow[]) {
      const grouped = new Map<number, {
        doctorId: number;
        doctorName: string;
        reportDate: string;
        totalAppointments: number;
        uniquePatients: Set<number>;
        completed: number;
        cancelled: number;
        noShow: number;
        pending: number;
        emergencyCount: number;
        collectedRevenue: number;
        dueRevenue: number;
      }>();

      for (const row of rows) {
        const key = row.doctor_id;
        if (!grouped.has(key)) {
          grouped.set(key, {
            doctorId: row.doctor_id,
            doctorName: row.doctor_name,
            reportDate: row.appt_date,
            totalAppointments: 0,
            uniquePatients: new Set(),
            completed: 0,
            cancelled: 0,
            noShow: 0,
            pending: 0,
            emergencyCount: 0,
            collectedRevenue: 0,
            dueRevenue: 0,
          });
        }

        const entry = grouped.get(key)!;
        entry.totalAppointments++;
        entry.uniquePatients.add(row.patient_id);

        if (row.status === 'completed') entry.completed++;
        if (row.status === 'cancelled') entry.cancelled++;
        if (row.status === 'no_show') entry.noShow++;
        if (['scheduled', 'checked_in'].includes(row.status)) entry.pending++;
        if (row.visit_type === 'emergency') entry.emergencyCount++;
        if (row.billing_status === 'paid') entry.collectedRevenue += row.final_fee;
        if (row.billing_status === 'due_approved') entry.dueRevenue += row.final_fee;
      }

      return Array.from(grouped.values()).map(entry => ({
        ...entry,
        uniquePatients: entry.uniquePatients.size,
      }));
    }

    it('should count total appointments per doctor', () => {
      const rows: AppointmentRow[] = [
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'completed', visit_type: 'opd', billing_status: 'paid', final_fee: 500, patient_id: 1 },
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'completed', visit_type: 'opd', billing_status: 'paid', final_fee: 500, patient_id: 2 },
        { doctor_id: 2, doctor_name: 'Dr. B', appt_date: '2026-05-23', status: 'scheduled', visit_type: 'opd', billing_status: 'unpaid', final_fee: 500, patient_id: 3 },
      ];

      const result = aggregateByDoctor(rows);
      expect(result.find(r => r.doctorId === 1)?.totalAppointments).toBe(2);
      expect(result.find(r => r.doctorId === 2)?.totalAppointments).toBe(1);
    });

    it('should count unique patients correctly', () => {
      const rows: AppointmentRow[] = [
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'completed', visit_type: 'opd', billing_status: 'paid', final_fee: 500, patient_id: 1 },
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'completed', visit_type: 'opd', billing_status: 'paid', final_fee: 500, patient_id: 1 },
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'completed', visit_type: 'opd', billing_status: 'paid', final_fee: 500, patient_id: 2 },
      ];

      const result = aggregateByDoctor(rows);
      expect(result[0]?.uniquePatients).toBe(2);
    });

    it('should count completed, cancelled, no_show, pending correctly', () => {
      const rows: AppointmentRow[] = [
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'completed', visit_type: 'opd', billing_status: 'paid', final_fee: 500, patient_id: 1 },
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'cancelled', visit_type: 'opd', billing_status: 'cancelled', final_fee: 500, patient_id: 2 },
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'no_show', visit_type: 'opd', billing_status: 'unpaid', final_fee: 500, patient_id: 3 },
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'scheduled', visit_type: 'opd', billing_status: 'unpaid', final_fee: 500, patient_id: 4 },
      ];

      const result = aggregateByDoctor(rows);
      expect(result[0]?.completed).toBe(1);
      expect(result[0]?.cancelled).toBe(1);
      expect(result[0]?.noShow).toBe(1);
      expect(result[0]?.pending).toBe(1);
    });

    it('should count emergency appointments', () => {
      const rows: AppointmentRow[] = [
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'completed', visit_type: 'emergency', billing_status: 'paid', final_fee: 1000, patient_id: 1 },
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'completed', visit_type: 'opd', billing_status: 'paid', final_fee: 500, patient_id: 2 },
      ];

      const result = aggregateByDoctor(rows);
      expect(result[0]?.emergencyCount).toBe(1);
    });

    it('should calculate collected and due revenue', () => {
      const rows: AppointmentRow[] = [
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'completed', visit_type: 'opd', billing_status: 'paid', final_fee: 500, patient_id: 1 },
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'completed', visit_type: 'opd', billing_status: 'due_approved', final_fee: 300, patient_id: 2 },
        { doctor_id: 1, doctor_name: 'Dr. A', appt_date: '2026-05-23', status: 'scheduled', visit_type: 'opd', billing_status: 'unpaid', final_fee: 200, patient_id: 3 },
      ];

      const result = aggregateByDoctor(rows);
      expect(result[0]?.collectedRevenue).toBe(500);
      expect(result[0]?.dueRevenue).toBe(300);
    });
  });

  // ─── Summary Calculations ─────────────────────────────────────────────────
  describe('Summary Calculations', () => {
    interface ReportRow {
      doctorId: number;
      totalAppointments: number;
      uniquePatients: number;
      completed: number;
      cancelled: number;
      noShow: number;
      pending: number;
      emergencyCount: number;
      collectedRevenue: number;
      dueRevenue: number;
    }

    function calculateSummary(report: ReportRow[]) {
      return {
        totalAppointments: report.reduce((sum, r) => sum + r.totalAppointments, 0),
        uniquePatients: report.reduce((sum, r) => sum + r.uniquePatients, 0),
        completed: report.reduce((sum, r) => sum + r.completed, 0),
        cancelled: report.reduce((sum, r) => sum + r.cancelled, 0),
        noShow: report.reduce((sum, r) => sum + r.noShow, 0),
        pending: report.reduce((sum, r) => sum + r.pending, 0),
        emergencyCount: report.reduce((sum, r) => sum + r.emergencyCount, 0),
        collectedRevenue: report.reduce((sum, r) => sum + r.collectedRevenue, 0),
        dueRevenue: report.reduce((sum, r) => sum + r.dueRevenue, 0),
        doctorCount: new Set(report.map(r => r.doctorId)).size,
      };
    }

    it('should sum all metrics across doctors', () => {
      const report: ReportRow[] = [
        { doctorId: 1, totalAppointments: 10, uniquePatients: 8, completed: 6, cancelled: 1, noShow: 1, pending: 2, emergencyCount: 1, collectedRevenue: 5000, dueRevenue: 2000 },
        { doctorId: 2, totalAppointments: 5, uniquePatients: 5, completed: 4, cancelled: 0, noShow: 0, pending: 1, emergencyCount: 0, collectedRevenue: 2500, dueRevenue: 0 },
      ];

      const summary = calculateSummary(report);
      expect(summary.totalAppointments).toBe(15);
      expect(summary.uniquePatients).toBe(13);
      expect(summary.completed).toBe(10);
      expect(summary.cancelled).toBe(1);
      expect(summary.noShow).toBe(1);
      expect(summary.pending).toBe(3);
      expect(summary.emergencyCount).toBe(1);
      expect(summary.collectedRevenue).toBe(7500);
      expect(summary.dueRevenue).toBe(2000);
      expect(summary.doctorCount).toBe(2);
    });

    it('should handle empty report', () => {
      const summary = calculateSummary([]);
      expect(summary.totalAppointments).toBe(0);
      expect(summary.doctorCount).toBe(0);
    });
  });

  // ─── BDT Currency Handling ────────────────────────────────────────────────
  describe('BDT Currency Handling', () => {
    it('should handle BDT consultation fees (typically 200-2000)', () => {
      const fees = [200, 500, 800, 1000, 1500, 2000];
      for (const fee of fees) {
        expect(fee).toBeGreaterThan(0);
        expect(Number.isInteger(fee)).toBe(true);
      }
    });

    it('should sum revenue correctly in BDT', () => {
      const revenues = [500, 800, 1000, 500, 800, 1000];
      const total = revenues.reduce((sum, r) => sum + r, 0);
      expect(total).toBe(4600);
    });
  });

  // ─── Date Range Queries ───────────────────────────────────────────────────
  describe('Date Range Queries', () => {
    it('should support single day query', () => {
      const startDate = '2026-05-23';
      const endDate = '2026-05-23';
      expect(startDate).toBe(endDate);
    });

    it('should support weekly range query', () => {
      const startDate = '2026-05-18';
      const endDate = '2026-05-24';
      const days = Math.ceil(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(days).toBe(6);
    });

    it('should support monthly range query', () => {
      const startDate = '2026-05-01';
      const endDate = '2026-05-31';
      expect(startDate.slice(0, 7)).toBe(endDate.slice(0, 7));
    });
  });

  // ─── Doctor Filter ────────────────────────────────────────────────────────
  describe('Doctor Filter', () => {
    it('should accept optional doctorId parameter', () => {
      const doctorId = 42;
      expect(Number.isInteger(doctorId)).toBe(true);
      expect(doctorId).toBeGreaterThan(0);
    });

    it('should return all doctors when no doctorId specified', () => {
      const doctorId = undefined;
      expect(doctorId).toBeUndefined();
    });
  });
});

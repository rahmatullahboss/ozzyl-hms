import { describe, it, expect } from 'vitest';
import { createAppointmentSchema, updateAppointmentSchema } from '../src/schemas/appointment';

// ─── Receptionist Module Unit Tests ─────────────────────────────────────────
// Covers: pending_approval status, appointment source, rescheduling date,
//         online approval flow logic, reception reports data structures

describe('Receptionist Module', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // pending_approval status (Online Appointment Approval)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Update Schema — pending_approval status', () => {
    it('should accept pending_approval as valid status', () => {
      const result = updateAppointmentSchema.safeParse({ status: 'pending_approval' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('pending_approval');
    });

    it('should accept transition from pending_approval to scheduled (approve)', () => {
      const result = updateAppointmentSchema.safeParse({ status: 'scheduled' });
      expect(result.success).toBe(true);
    });

    it('should accept transition from pending_approval to cancelled (reject)', () => {
      const result = updateAppointmentSchema.safeParse({ status: 'cancelled' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status like approved', () => {
      const result = updateAppointmentSchema.safeParse({ status: 'approved' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid status like pending', () => {
      const result = updateAppointmentSchema.safeParse({ status: 'pending' });
      expect(result.success).toBe(false);
    });

    it('all 6 statuses should be accepted', () => {
      const statuses = ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'];
      for (const status of statuses) {
        const result = updateAppointmentSchema.safeParse({ status });
        expect(result.success, `status '${status}' should be valid`).toBe(true);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Appointment Source Tracking
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Create Schema — source field', () => {
    it('should default source to scheduled when not provided', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
        apptDate: '2026-05-01',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.source).toBe('scheduled');
    });

    it('should accept walk_in as source', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
        apptDate: '2026-05-01',
        source: 'walk_in',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.source).toBe('walk_in');
    });

    it('should accept online as source', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
        apptDate: '2026-05-01',
        source: 'online',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.source).toBe('online');
    });

    it('should accept phone as source', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
        apptDate: '2026-05-01',
        source: 'phone',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.source).toBe('phone');
    });

    it('should reject invalid source like email', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
        apptDate: '2026-05-01',
        source: 'email',
      });
      expect(result.success).toBe(false);
    });

    it('should accept all 4 valid sources', () => {
      const sources = ['scheduled', 'walk_in', 'online', 'phone'];
      for (const source of sources) {
        const result = createAppointmentSchema.safeParse({
          patientId: 1,
          apptDate: '2026-05-01',
          source,
        });
        expect(result.success, `source '${source}' should be valid`).toBe(true);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Rescheduling with apptDate
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Update Schema — rescheduling fields', () => {
    it('should accept apptDate in update for rescheduling', () => {
      const result = updateAppointmentSchema.safeParse({
        status: 'scheduled',
        apptDate: '2026-06-15',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.apptDate).toBe('2026-06-15');
    });

    it('should accept apptTime in update for rescheduling', () => {
      const result = updateAppointmentSchema.safeParse({
        apptTime: '14:30',
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.apptTime).toBe('14:30');
    });

    it('should accept doctorId in update for rescheduling', () => {
      const result = updateAppointmentSchema.safeParse({
        doctorId: 5,
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.doctorId).toBe(5);
    });

    it('should accept full reschedule payload', () => {
      const result = updateAppointmentSchema.safeParse({
        status: 'scheduled',
        apptDate: '2026-06-20',
        apptTime: '09:00',
        doctorId: 3,
      });
      expect(result.success).toBe(true);
    });

    it('should reject malformed apptDate in reschedule', () => {
      const result = updateAppointmentSchema.safeParse({
        apptDate: '15-06-2026',
      });
      expect(result.success).toBe(false);
    });

    it('should reject malformed apptTime in reschedule', () => {
      const result = updateAppointmentSchema.safeParse({
        apptTime: '2:30 PM',
      });
      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Online Appointment Approval Logic
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Online Appointment Approval Logic', () => {
    type ApptStatus = 'scheduled' | 'checked_in' | 'completed' | 'cancelled' | 'no_show' | 'pending_approval';

    function canApprove(status: ApptStatus): boolean {
      return status === 'pending_approval';
    }

    function canReject(status: ApptStatus): boolean {
      return status === 'pending_approval';
    }

    function approveAction(status: ApptStatus): ApptStatus {
      return status === 'pending_approval' ? 'scheduled' : status;
    }

    function rejectAction(status: ApptStatus): ApptStatus {
      return status === 'pending_approval' ? 'cancelled' : status;
    }

    it('should allow approving pending_approval appointments', () => {
      expect(canApprove('pending_approval')).toBe(true);
    });

    it('should not allow approving already scheduled appointments', () => {
      expect(canApprove('scheduled')).toBe(false);
    });

    it('should not allow approving completed appointments', () => {
      expect(canApprove('completed')).toBe(false);
    });

    it('should allow rejecting pending_approval appointments', () => {
      expect(canReject('pending_approval')).toBe(true);
    });

    it('should not allow rejecting already cancelled appointments', () => {
      expect(canReject('cancelled')).toBe(false);
    });

    it('approve should transition pending_approval → scheduled', () => {
      expect(approveAction('pending_approval')).toBe('scheduled');
    });

    it('reject should transition pending_approval → cancelled', () => {
      expect(rejectAction('pending_approval')).toBe('cancelled');
    });

    it('approve should not change already scheduled status', () => {
      expect(approveAction('scheduled')).toBe('scheduled');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Reception Reports Data Structures
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Reception Reports — Daily Collection', () => {
    interface DailyCollectionSummary {
      net_collection: number;
      cash_sales: number;
      total_returns: number;
      pending_dues: number;
    }

    function calculateNetCollection(summary: DailyCollectionSummary): number {
      return summary.cash_sales - summary.total_returns;
    }

    function fmtMoney(paisa: number): string {
      return `৳${Math.round(paisa / 100).toLocaleString()}`;
    }

    it('should calculate net collection correctly', () => {
      const summary: DailyCollectionSummary = {
        net_collection: 0,
        cash_sales: 500000,
        total_returns: 50000,
        pending_dues: 100000,
      };
      expect(calculateNetCollection(summary)).toBe(450000);
    });

    it('should handle zero returns', () => {
      const summary: DailyCollectionSummary = {
        net_collection: 0,
        cash_sales: 300000,
        total_returns: 0,
        pending_dues: 0,
      };
      expect(calculateNetCollection(summary)).toBe(300000);
    });

    it('should handle negative net when returns exceed sales', () => {
      const summary: DailyCollectionSummary = {
        net_collection: 0,
        cash_sales: 10000,
        total_returns: 50000,
        pending_dues: 0,
      };
      expect(calculateNetCollection(summary)).toBe(-40000);
    });

    it('should format money with taka symbol', () => {
      expect(fmtMoney(50000)).toBe('৳500');
    });

    it('should format zero correctly', () => {
      expect(fmtMoney(0)).toBe('৳0');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Appointment Source Badge Display
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Appointment Source Badge', () => {
    function shouldShowSourceBadge(source: string): boolean {
      return source !== 'scheduled';
    }

    function getSourceLabel(source: string): string {
      switch (source) {
        case 'walk_in': return 'Walk-in';
        case 'online':  return 'Online';
        case 'phone':   return 'Phone';
        default:        return '';
      }
    }

    it('should not show badge for scheduled source', () => {
      expect(shouldShowSourceBadge('scheduled')).toBe(false);
    });

    it('should show badge for walk_in source', () => {
      expect(shouldShowSourceBadge('walk_in')).toBe(true);
    });

    it('should show badge for online source', () => {
      expect(shouldShowSourceBadge('online')).toBe(true);
    });

    it('should show badge for phone source', () => {
      expect(shouldShowSourceBadge('phone')).toBe(true);
    });

    it('should return Walk-in label for walk_in source', () => {
      expect(getSourceLabel('walk_in')).toBe('Walk-in');
    });

    it('should return Online label for online source', () => {
      expect(getSourceLabel('online')).toBe('Online');
    });

    it('should return Phone label for phone source', () => {
      expect(getSourceLabel('phone')).toBe('Phone');
    });

    it('should return empty string for scheduled source', () => {
      expect(getSourceLabel('scheduled')).toBe('');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Appointment Reminder Logic
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Appointment Reminder', () => {
    type ApptStatus = 'scheduled' | 'checked_in' | 'completed' | 'cancelled' | 'no_show' | 'pending_approval';

    function canSendReminder(status: ApptStatus): boolean {
      return status === 'scheduled';
    }

    interface ReminderPayload {
      patientName: string;
      patientPhone?: string;
      doctorName: string;
      appointmentDate: string;
      appointmentTime: string;
      channel: 'sms' | 'email' | 'both';
    }

    function buildReminderPayload(appt: {
      patient_name: string;
      patient_mobile: string;
      doctor_name: string | null;
      appt_date: string;
      appt_time: string | null;
    }): ReminderPayload {
      return {
        patientName: appt.patient_name,
        patientPhone: appt.patient_mobile || undefined,
        doctorName: appt.doctor_name || 'Doctor',
        appointmentDate: appt.appt_date,
        appointmentTime: appt.appt_time || '—',
        channel: 'both',
      };
    }

    it('should allow sending reminder for scheduled appointments', () => {
      expect(canSendReminder('scheduled')).toBe(true);
    });

    it('should not allow sending reminder for completed appointments', () => {
      expect(canSendReminder('completed')).toBe(false);
    });

    it('should not allow sending reminder for cancelled appointments', () => {
      expect(canSendReminder('cancelled')).toBe(false);
    });

    it('should not allow sending reminder for pending_approval appointments', () => {
      expect(canSendReminder('pending_approval')).toBe(false);
    });

    it('should build correct reminder payload', () => {
      const payload = buildReminderPayload({
        patient_name: 'Rahim Khan',
        patient_mobile: '01712345678',
        doctor_name: 'Dr. Karim',
        appt_date: '2026-05-10',
        appt_time: '10:30',
      });
      expect(payload.patientName).toBe('Rahim Khan');
      expect(payload.doctorName).toBe('Dr. Karim');
      expect(payload.channel).toBe('both');
    });

    it('should fallback to Doctor when doctor_name is null', () => {
      const payload = buildReminderPayload({
        patient_name: 'Fatima',
        patient_mobile: '01898765432',
        doctor_name: null,
        appt_date: '2026-05-10',
        appt_time: null,
      });
      expect(payload.doctorName).toBe('Doctor');
      expect(payload.appointmentTime).toBe('—');
    });

    it('should set patientPhone to undefined when mobile is empty', () => {
      const payload = buildReminderPayload({
        patient_name: 'Test',
        patient_mobile: '',
        doctor_name: 'Dr. A',
        appt_date: '2026-05-10',
        appt_time: '09:00',
      });
      expect(payload.patientPhone).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Pending Approval Status Badge
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Status Badge Styling — pending_approval', () => {
    const STATUS_STYLE: Record<string, string> = {
      scheduled:        'bg-blue-50 text-blue-700 border-blue-200',
      checked_in:       'bg-teal-50 text-teal-700 border-teal-200',
      completed:        'bg-emerald-50 text-emerald-700 border-emerald-200',
      cancelled:        'bg-gray-100 text-gray-500 border-gray-200 line-through',
      no_show:          'bg-amber-50 text-amber-700 border-amber-200',
      pending_approval: 'bg-orange-50 text-orange-700 border-orange-200',
    };

    it('should have style for pending_approval', () => {
      expect(STATUS_STYLE).toHaveProperty('pending_approval');
    });

    it('should use orange theme for pending_approval', () => {
      expect(STATUS_STYLE.pending_approval).toContain('orange');
    });

    it('should have styles for all 6 statuses', () => {
      const expected = ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show', 'pending_approval'];
      expected.forEach(s => expect(STATUS_STYLE).toHaveProperty(s));
    });
  });
});

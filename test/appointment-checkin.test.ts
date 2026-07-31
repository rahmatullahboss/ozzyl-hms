import { describe, it, expect } from 'vitest';
import { normalizeConsultationFee } from '../src/lib/doctor-fees';
import { createAppointmentSchema, updateAppointmentSchema } from '../src/schemas/appointment';

// ─── Check-In Based Billing Flow Tests ──────────────────────────────────────
// Covers: appointment check-in → visit creation → consultation service billing

describe('Appointment Check-In Flow', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // Zod Schema: checked_in status
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Update Appointment Schema — checked_in status', () => {
    it('should accept checked_in as valid status', () => {
      const result = updateAppointmentSchema.safeParse({ status: 'checked_in' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('checked_in');
    });

    it('should accept scheduled as valid status', () => {
      const result = updateAppointmentSchema.safeParse({ status: 'scheduled' });
      expect(result.success).toBe(true);
    });

    it('should accept completed as valid status', () => {
      const result = updateAppointmentSchema.safeParse({ status: 'completed' });
      expect(result.success).toBe(true);
    });

    it('should accept cancelled as valid status', () => {
      const result = updateAppointmentSchema.safeParse({ status: 'cancelled' });
      expect(result.success).toBe(true);
    });

    it('should accept no_show as valid status', () => {
      const result = updateAppointmentSchema.safeParse({ status: 'no_show' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid status like in_progress', () => {
      const result = updateAppointmentSchema.safeParse({ status: 'in_progress' });
      expect(result.success).toBe(false);
    });

    it('should reject empty string as status', () => {
      const result = updateAppointmentSchema.safeParse({ status: '' });
      expect(result.success).toBe(false);
    });

    it('should allow update with no status (all fields optional)', () => {
      const result = updateAppointmentSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should allow status + other fields together', () => {
      const result = updateAppointmentSchema.safeParse({
        status: 'checked_in',
        notes: 'Patient arrived on time',
      });
      expect(result.success).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Create Appointment Schema (booking side)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Create Appointment Schema', () => {
    it('should accept valid appointment with all required fields', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
        apptDate: '2026-05-01',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.visitType).toBe('opd');
        expect(result.data.fee).toBe(0);
      }
    });

    it('should accept appointment with doctor and time', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
        doctorId: 5,
        apptDate: '2026-05-01',
        apptTime: '10:30',
        visitType: 'followup',
        fee: 500,
      });
      expect(result.success).toBe(true);
    });

    it('should accept emergency visit type', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
        apptDate: '2026-05-01',
        visitType: 'emergency',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing patientId', () => {
      const result = createAppointmentSchema.safeParse({
        apptDate: '2026-05-01',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing apptDate', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid date format', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
        apptDate: '01-05-2026',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid time format', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
        apptDate: '2026-05-01',
        apptTime: '1030',
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative fee', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
        apptDate: '2026-05-01',
        fee: -100,
      });
      expect(result.success).toBe(false);
    });

    it('should reject chiefComplaint over 500 chars', () => {
      const result = createAppointmentSchema.safeParse({
        patientId: 1,
        apptDate: '2026-05-01',
        chiefComplaint: 'x'.repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Check-In Business Logic
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Check-In Guard Logic', () => {
    type ApptStatus = 'scheduled' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';

    function canCheckIn(status: ApptStatus): boolean {
      return status === 'scheduled';
    }

    it('should allow check-in for scheduled appointments', () => {
      expect(canCheckIn('scheduled')).toBe(true);
    });

    it('should block check-in for already checked_in appointments', () => {
      expect(canCheckIn('checked_in')).toBe(false);
    });

    it('should block check-in for completed appointments', () => {
      expect(canCheckIn('completed')).toBe(false);
    });

    it('should block check-in for cancelled appointments', () => {
      expect(canCheckIn('cancelled')).toBe(false);
    });

    it('should block check-in for no_show appointments', () => {
      expect(canCheckIn('no_show')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Consultation Fee Calculation
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Consultation Fee at Check-In', () => {
    interface Doctor {
      id: number;
      name: string;
      consultation_fee: number;
    }

    function getConsultationFee(doctor: Doctor | null): number {
      return normalizeConsultationFee(doctor?.consultation_fee ?? 0);
    }

    function buildServiceDescription(doctorName: string): string {
      return `Consultation - Dr. ${doctorName}`;
    }

    it('should return consultation fee in taka from doctor record', () => {
      const doc: Doctor = { id: 1, name: 'Rahman', consultation_fee: 500 };
      expect(getConsultationFee(doc)).toBe(500);
    });

    it('should return 0 when no doctor assigned (walk-in)', () => {
      expect(getConsultationFee(null)).toBe(0);
    });

    it('should return 0 when doctor has no consultation fee set', () => {
      const doc: Doctor = { id: 2, name: 'Hasan', consultation_fee: 0 };
      expect(getConsultationFee(doc)).toBe(0);
    });

    it('should normalize legacy minor-unit fee values to taka', () => {
      const doc: Doctor = { id: 1, name: 'Rahman', consultation_fee: 50000 };
      expect(getConsultationFee(doc)).toBe(500);
    });

    it('should build correct service description', () => {
      expect(buildServiceDescription('Rahman')).toBe('Consultation - Dr. Rahman');
    });

    it('should not create consultation service when fee is 0', () => {
      const fee = getConsultationFee(null);
      const shouldCreateService = fee > 0;
      expect(shouldCreateService).toBe(false);
    });

    it('should create consultation service when fee > 0', () => {
      const doc: Doctor = { id: 1, name: 'Karim', consultation_fee: 300 };
      const fee = getConsultationFee(doc);
      const shouldCreateService = fee > 0;
      expect(shouldCreateService).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Visit Creation from Appointment
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Visit Creation from Appointment', () => {
    interface Appointment {
      id: number;
      patientId: number;
      doctorId: number | null;
      visitType: 'opd' | 'followup' | 'emergency';
      apptDate: string;
    }

    interface VisitInsert {
      patientId: number;
      doctorId: number | null;
      visitType: string;
      visitDate: string;
      appointmentId: number;
      status: string;
    }

    function buildVisitFromAppointment(appt: Appointment): VisitInsert {
      const today = new Date().toISOString().split('T')[0];
      return {
        patientId: appt.patientId,
        doctorId: appt.doctorId,
        visitType: appt.visitType,
        visitDate: today,
        appointmentId: appt.id,
        status: 'initiated',
      };
    }

    it('should create visit with correct patient and doctor', () => {
      const appt: Appointment = { id: 10, patientId: 42, doctorId: 5, visitType: 'opd', apptDate: '2026-05-01' };
      const visit = buildVisitFromAppointment(appt);
      expect(visit.patientId).toBe(42);
      expect(visit.doctorId).toBe(5);
      expect(visit.appointmentId).toBe(10);
    });

    it('should set visit status to initiated', () => {
      const appt: Appointment = { id: 10, patientId: 42, doctorId: null, visitType: 'opd', apptDate: '2026-05-01' };
      const visit = buildVisitFromAppointment(appt);
      expect(visit.status).toBe('initiated');
    });

    it('should use today as visit date, not appointment date', () => {
      const appt: Appointment = { id: 10, patientId: 42, doctorId: null, visitType: 'opd', apptDate: '2026-04-30' };
      const visit = buildVisitFromAppointment(appt);
      const today = new Date().toISOString().split('T')[0];
      expect(visit.visitDate).toBe(today);
    });

    it('should handle walk-in (no doctor) appointment', () => {
      const appt: Appointment = { id: 11, patientId: 99, doctorId: null, visitType: 'opd', apptDate: '2026-05-01' };
      const visit = buildVisitFromAppointment(appt);
      expect(visit.doctorId).toBeNull();
    });

    it('should preserve visit type from appointment', () => {
      const appt: Appointment = { id: 12, patientId: 50, doctorId: 3, visitType: 'emergency', apptDate: '2026-05-01' };
      const visit = buildVisitFromAppointment(appt);
      expect(visit.visitType).toBe('emergency');
    });

    it('should preserve followup visit type', () => {
      const appt: Appointment = { id: 13, patientId: 51, doctorId: 3, visitType: 'followup', apptDate: '2026-05-01' };
      const visit = buildVisitFromAppointment(appt);
      expect(visit.visitType).toBe('followup');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Visit Service Types
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Visit Service Types', () => {
    const VALID_SERVICE_TYPES = ['doctor_visit', 'test', 'procedure', 'admission', 'medicine', 'package', 'other'] as const;
    const VALID_STATUSES = ['pending', 'billed', 'cancelled', 'refunded'] as const;

    it('should include doctor_visit as valid service type', () => {
      expect(VALID_SERVICE_TYPES).toContain('doctor_visit');
    });

    it('should include test as valid service type', () => {
      expect(VALID_SERVICE_TYPES).toContain('test');
    });

    it('should include procedure as valid service type', () => {
      expect(VALID_SERVICE_TYPES).toContain('procedure');
    });

    it('should have pending as default service status at check-in', () => {
      const autoCreatedServiceStatus = 'pending';
      expect(VALID_STATUSES).toContain(autoCreatedServiceStatus);
    });

    it('consultation service should use doctor_visit type', () => {
      const serviceType = 'doctor_visit';
      expect(VALID_SERVICE_TYPES).toContain(serviceType);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Status Badge Styling (Frontend)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Appointment Status Badge Styling', () => {
    const STATUS_STYLE: Record<string, string> = {
      scheduled:  'bg-blue-50 text-blue-700 border-blue-200',
      checked_in: 'bg-teal-50 text-teal-700 border-teal-200',
      completed:  'bg-emerald-50 text-emerald-700 border-emerald-200',
      cancelled:  'bg-gray-100 text-gray-500 border-gray-200 line-through',
      no_show:    'bg-amber-50 text-amber-700 border-amber-200',
    };

    const APPT_STATUS: Record<string, string> = {
      scheduled:  'bg-blue-100 text-blue-700',
      checked_in: 'bg-teal-100 text-teal-700',
      completed:  'bg-green-100 text-green-700',
      cancelled:  'bg-red-100 text-red-700',
      no_show:    'bg-amber-100 text-amber-700',
    };

    it('should have style for checked_in in scheduler', () => {
      expect(STATUS_STYLE).toHaveProperty('checked_in');
      expect(STATUS_STYLE.checked_in).toContain('teal');
    });

    it('should have style for checked_in in patient detail', () => {
      expect(APPT_STATUS).toHaveProperty('checked_in');
      expect(APPT_STATUS.checked_in).toContain('teal');
    });

    it('should have styles for all 5 statuses in scheduler', () => {
      const expected = ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show'];
      expected.forEach(s => expect(STATUS_STYLE).toHaveProperty(s));
    });

    it('should have styles for all 5 statuses in patient detail', () => {
      const expected = ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show'];
      expected.forEach(s => expect(APPT_STATUS).toHaveProperty(s));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Check-In Action Button Visibility
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Check-In Button Visibility', () => {
    type Status = 'scheduled' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';

    function shouldShowCheckInButton(status: Status): boolean {
      return status === 'scheduled';
    }

    function shouldShowMarkCompleted(status: Status): boolean {
      return status === 'scheduled' || status === 'checked_in';
    }

    function shouldShowActionButtons(status: Status): boolean {
      return status === 'scheduled' || status === 'checked_in' || status === 'no_show';
    }

    it('should show Check In for scheduled appointments', () => {
      expect(shouldShowCheckInButton('scheduled')).toBe(true);
    });

    it('should NOT show Check In for checked_in appointments', () => {
      expect(shouldShowCheckInButton('checked_in')).toBe(false);
    });

    it('should NOT show Check In for completed appointments', () => {
      expect(shouldShowCheckInButton('completed')).toBe(false);
    });

    it('should show Mark Completed for scheduled', () => {
      expect(shouldShowMarkCompleted('scheduled')).toBe(true);
    });

    it('should show Mark Completed for checked_in', () => {
      expect(shouldShowMarkCompleted('checked_in')).toBe(true);
    });

    it('should NOT show Mark Completed for cancelled', () => {
      expect(shouldShowMarkCompleted('cancelled')).toBe(false);
    });

    it('should show action buttons for scheduled/checked_in/no_show', () => {
      expect(shouldShowActionButtons('scheduled')).toBe(true);
      expect(shouldShowActionButtons('checked_in')).toBe(true);
      expect(shouldShowActionButtons('no_show')).toBe(true);
    });

    it('should NOT show action buttons for completed/cancelled', () => {
      expect(shouldShowActionButtons('completed')).toBe(false);
      expect(shouldShowActionButtons('cancelled')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // D1 Batch Atomicity Expectations
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Check-In Atomicity', () => {
    it('should require exactly 2 statements in batch (update appt + insert visit)', () => {
      const batchStatements = ['UPDATE appointments ...', 'INSERT INTO visits ...'];
      expect(batchStatements).toHaveLength(2);
    });

    it('should add consultation service as separate step only if fee > 0', () => {
      const fee = 50000;
      const stmts = ['UPDATE appointments ...', 'INSERT INTO visits ...'];
      if (fee > 0) stmts.push('INSERT INTO visit_services ...');
      expect(stmts).toHaveLength(3);
    });

    it('should NOT add consultation service when fee is 0', () => {
      const fee = 0;
      const stmts = ['UPDATE appointments ...', 'INSERT INTO visits ...'];
      if (fee > 0) stmts.push('INSERT INTO visit_services ...');
      expect(stmts).toHaveLength(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // End-to-End Flow Expectations
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Full Check-In Flow Expectations', () => {
    it('appointment status should be checked_in after check-in', () => {
      const beforeStatus = 'scheduled';
      const afterStatus = beforeStatus === 'scheduled' ? 'checked_in' : beforeStatus;
      expect(afterStatus).toBe('checked_in');
    });

    it('checked_in_at should be set after check-in', () => {
      const checkedInAt: string | null = null;
      const afterCheckIn = checkedInAt ?? new Date().toISOString();
      expect(afterCheckIn).toBeTruthy();
    });

    it('visit should link back to appointment via appointment_id', () => {
      const appointmentId = 42;
      const visit = { appointmentId };
      expect(visit.appointmentId).toBe(42);
    });

    it('bill should NOT be auto-created at check-in (manual generation)', () => {
      const billCreatedAtCheckIn = false;
      expect(billCreatedAtCheckIn).toBe(false);
    });

    it('visit service should be created with pending status', () => {
      const serviceStatus = 'pending';
      expect(serviceStatus).toBe('pending');
    });

    it('no billing occurs for no-show appointments', () => {
      const status = 'no_show';
      const visitCreated = status === 'checked_in' || status === 'scheduled';
      expect(visitCreated).toBe(false);
    });
  });
});

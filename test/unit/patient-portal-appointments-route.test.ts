import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routeFile = resolve(__dirname, '../../src/routes/tenant/patientPortal.ts');

describe('tenant patient portal appointment routes', () => {
  it('enforces server-side appointment time conflict checks before booking', () => {
    const source = readFileSync(routeFile, 'utf8');

    expect(source).toContain('function normalizePatientAppointmentTime');
    expect(source).toContain('async function assertPatientAppointmentTimeAvailable');
    expect(source).toContain('await assertPatientAppointmentTimeAvailable(db, {');
    expect(source).toContain("message: 'This appointment time is already booked. Choose another time.'");
    expect(source).toContain('bookedTimes: normalizePatientBookedTimes(bookedSlots ?? [])');
    expect(source).toContain('PATIENT_NON_ACTIVE_APPOINTMENT_STATUSES');
    expect(source).toContain('duplicate active booking');
  });

  it('allows patients to cancel their own pending or confirmed appointment states, not only scheduled', () => {
    const source = readFileSync(routeFile, 'utf8');

    expect(source).toContain('const PATIENT_CANCELLABLE_APPOINTMENT_STATUSES = new Set');
    expect(source).toContain("'pending_approval'");
    expect(source).toContain("'scheduled'");
    expect(source).toContain("'confirmed'");
    expect(source).toContain('PATIENT_CANCELLABLE_APPOINTMENT_STATUSES.has(normalizeAppointmentStatus(appt.status))');
    expect(source).not.toContain("if (appt.status !== 'scheduled')");
  });

  it('generates enterprise available slot choices from active doctor schedules', () => {
    const source = readFileSync(routeFile, 'utf8');

    expect(source).toContain('function getPatientPortalDayKey');
    expect(source).toContain('function buildPatientAvailableSlots');
    expect(source).toContain('FROM doctor_schedules');
    expect(source).toContain('day_of_week = ?');
    expect(source).toContain('const availableSlots = buildPatientAvailableSlots(scheduleRows ?? [], bookedSlots ?? []);');
    expect(source).toContain('availableSlots,');
    expect(source).toContain('hasSchedule: (scheduleRows ?? []).length > 0');
    expect(source).toContain('async function assertPatientAppointmentTimeWithinSchedule');
    expect(source).toContain('await assertPatientAppointmentTimeWithinSchedule(db, {');
    expect(source).toContain("message: 'Selected appointment time is outside the doctor schedule or capacity.'");
  });

});

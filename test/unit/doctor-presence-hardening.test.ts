import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DOCTOR_PRESENCE_STATUS_VALUES,
  isDoctorAvailableForStatus,
} from '../../src/lib/doctor-daily-status';

const scheduleSource = readFileSync(join(process.cwd(), 'src/routes/tenant/doctor-schedule.ts'), 'utf8');
const statusSource = readFileSync(join(process.cwd(), 'src/lib/doctor-daily-status.ts'), 'utf8');

describe('doctor presence hardening', () => {
  it('supports operational arrival and absence states', () => {
    expect(DOCTOR_PRESENCE_STATUS_VALUES).toContain('on_the_way');
    expect(DOCTOR_PRESENCE_STATUS_VALUES).toContain('delayed');
    expect(DOCTOR_PRESENCE_STATUS_VALUES).toContain('emergency_delay');
    expect(DOCTOR_PRESENCE_STATUS_VALUES).toContain('not_coming');
    expect(DOCTOR_PRESENCE_STATUS_VALUES).toContain('chamber_closed');
    expect(DOCTOR_PRESENCE_STATUS_VALUES).toContain('serial_stopped');
  });

  it('classifies statuses for booking/reception availability logic', () => {
    expect(isDoctorAvailableForStatus('available')).toBe(true);
    expect(isDoctorAvailableForStatus('on_the_way')).toBe(true);
    expect(isDoctorAvailableForStatus('delayed')).toBe(true);
    expect(isDoctorAvailableForStatus('not_coming')).toBe(false);
    expect(isDoctorAvailableForStatus('chamber_closed')).toBe(false);
    expect(isDoctorAvailableForStatus('serial_stopped')).toBe(false);
  });

  it('keeps doctor self-update and reception override routes registered before dynamic doctor routes', () => {
    const selfRoute = scheduleSource.indexOf("doctorSchedule.put('/me/presence'");
    const boardRoute = scheduleSource.indexOf("doctorSchedule.get('/presence/today'");
    const overrideRoute = scheduleSource.indexOf("doctorSchedule.put('/:id/presence'");
    const dynamicScheduleRoute = scheduleSource.indexOf("doctorSchedule.get('/:id/schedule'");

    expect(selfRoute).toBeGreaterThan(-1);
    expect(boardRoute).toBeGreaterThan(-1);
    expect(overrideRoute).toBeGreaterThan(-1);
    expect(dynamicScheduleRoute).toBeGreaterThan(-1);
    expect(selfRoute).toBeLessThan(dynamicScheduleRoute);
    expect(boardRoute).toBeLessThan(dynamicScheduleRoute);
    expect(overrideRoute).toBeLessThan(dynamicScheduleRoute);
  });

  it('stores arrival ETA and audience-specific messages in doctor_daily_status', () => {
    expect(statusSource).toContain('expected_arrival_time');
    expect(statusSource).toContain('delay_minutes');
    expect(statusSource).toContain('public_message');
    expect(statusSource).toContain('reception_note');
    expect(statusSource).toContain('source');
  });

  it('allows doctor self-update but limits manual override to reception/admin roles', () => {
    expect(scheduleSource).toContain("requireSpecificRole(c, 'doctor')");
    expect(scheduleSource).toContain("requireSpecificRole(c, 'hospital_admin', 'reception', 'receptionist', 'md', 'director')");
    expect(scheduleSource).toContain('doctor_self_presence');
    expect(scheduleSource).toContain('reception_or_admin_presence_override');
  });
});

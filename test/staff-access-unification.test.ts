import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStaffSchema, updateStaffSchema } from '../src/schemas/staff';
import { createInvitationSchema } from '../src/schemas/invitation';
import { isStaffInviteRole, staffPositionToRole } from '../src/lib/staff-invite';

describe('staff access unification contract', () => {
  it('creates a staff profile without bank account, mobile or address', () => {
    const result = createStaffSchema.safeParse({
      name: 'Rahim Manager',
      position: 'Manager',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.salary).toBe(0);
      expect(result.data.bankAccount).toBeUndefined();
      expect(result.data.mobile).toBeUndefined();
      expect(result.data.address).toBeUndefined();
    }
  });

  it('accepts optional HR/profile fields that are edited later from staff profile', () => {
    const result = updateStaffSchema.safeParse({
      emergencyContact: '01711111111',
      bloodGroup: 'B+',
      category: 'manager',
      biometricDeviceId: 'BIO-001',
      shiftType: 'day-shift',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.emergencyContact).toBe('01711111111');
      expect(result.data.bloodGroup).toBe('B+');
      expect(result.data.biometricDeviceId).toBe('BIO-001');
    }
  });

  it('allows staff-linked management and operations invite roles but never tenant-owner roles', () => {
    for (const role of ['reception', 'manager', 'accountant', 'director', 'md', 'nurse', 'laboratory', 'pharmacist']) {
      const result = createInvitationSchema.safeParse({
        email: `${role}@demo.test`,
        role,
        staffId: 7,
      });
      expect(result.success).toBe(true);
      expect(isStaffInviteRole(role)).toBe(true);
    }

    const ownerInvite = createInvitationSchema.safeParse({
      email: 'owner@demo.test',
      role: 'hospital_admin',
      staffId: 7,
    });
    expect(ownerInvite.success).toBe(false);
    expect(isStaffInviteRole('hospital_admin')).toBe(false);
    expect(staffPositionToRole('Hospital Administrator')).toBeNull();
  });

  it('prevents staff and doctor identities from being linked to one invitation', () => {
    const result = createInvitationSchema.safeParse({
      email: 'doctor-staff@demo.test',
      role: 'doctor',
      doctorId: 5,
      staffId: 7,
    });

    expect(result.success).toBe(false);
  });

  it('maps common staff designations to login roles for legacy invite flow', () => {
    expect(staffPositionToRole('Senior Receptionist')?.role).toBe('reception');
    expect(staffPositionToRole('Managing Director')?.role).toBe('md');
    expect(staffPositionToRole('Finance Accountant')?.role).toBe('accountant');
    expect(staffPositionToRole('Lab Technician')?.role).toBe('laboratory');
  });

  it('migration keeps database storage aligned with optional staff profile fields', () => {
    const migration = readFileSync(resolve(__dirname, '../migrations/0386_staff_profile_hr_optional_fields.sql'), 'utf8');
    for (const column of ['emergency_contact', 'blood_group', 'category', 'biometric_device_id', 'shift_type']) {
      expect(migration).toContain(`ADD COLUMN ${column}`);
    }
  });
});

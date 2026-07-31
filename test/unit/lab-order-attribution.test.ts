import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../helpers/sqlite-d1';
import { resolveOrderingClinicianDoctorId } from '../../src/lib/lab-order-attribution';

function createHarness() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE doctors (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE visits (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER
    );

    INSERT INTO doctors (id, tenant_id, user_id, is_active) VALUES
      (11, 'tenant-a', 'user-doctor', 1),
      (12, 'tenant-a', 'user-inactive', 0),
      (21, 'tenant-a', 'user-ambiguous', 1),
      (22, 'tenant-a', 'user-ambiguous', 1),
      (31, 'tenant-b', 'user-cross-tenant', 1);

    INSERT INTO visits (id, tenant_id, doctor_id) VALUES
      (101, 'tenant-a', 11),
      (102, 'tenant-b', 31);
  `);
  return harness;
}

describe('resolveOrderingClinicianDoctorId', () => {
  it('prefers an explicit active doctor from the same tenant', async () => {
    const harness = createHarness();

    const result = await resolveOrderingClinicianDoctorId(harness.db, 'tenant-a', {
      enteredByUserId: 'reception-user',
      explicitDoctorId: 11,
    });

    expect(result).toBe(11);
  });

  it('uses the visit doctor when no explicit clinician is supplied', async () => {
    const harness = createHarness();

    const result = await resolveOrderingClinicianDoctorId(harness.db, 'tenant-a', {
      enteredByUserId: 'reception-user',
      visitId: 101,
    });

    expect(result).toBe(11);
  });

  it('maps entered-by user when exactly one active same-tenant doctor exists', async () => {
    const harness = createHarness();

    const result = await resolveOrderingClinicianDoctorId(harness.db, 'tenant-a', {
      enteredByUserId: 'user-doctor',
    });

    expect(result).toBe(11);
  });

  it('returns null for a receptionist without a doctor profile', async () => {
    const harness = createHarness();

    const result = await resolveOrderingClinicianDoctorId(harness.db, 'tenant-a', {
      enteredByUserId: 'reception-user',
    });

    expect(result).toBeNull();
  });

  it('returns null for ambiguous or inactive doctor profiles', async () => {
    const harness = createHarness();

    await expect(resolveOrderingClinicianDoctorId(harness.db, 'tenant-a', {
      enteredByUserId: 'user-ambiguous',
    })).resolves.toBeNull();

    await expect(resolveOrderingClinicianDoctorId(harness.db, 'tenant-a', {
      enteredByUserId: 'user-inactive',
    })).resolves.toBeNull();
  });

  it('rejects an explicit doctor from another tenant', async () => {
    const harness = createHarness();

    const result = await resolveOrderingClinicianDoctorId(harness.db, 'tenant-a', {
      enteredByUserId: 'user-cross-tenant',
      explicitDoctorId: 31,
    });

    expect(result).toBeNull();
  });
});

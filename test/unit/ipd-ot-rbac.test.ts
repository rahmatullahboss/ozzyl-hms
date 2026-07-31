/**
 * Unit tests for the IPD/OT/Nursing/CSSD local RBAC permission catalog (P0-26/27/28).
 */
import { describe, it, expect } from 'vitest';
import {
  hasPermission,
  rolesForPermission,
  IPD_OT_NURSING_PERMISSIONS,
  type RbacPermission,
} from '../../src/lib/ipd-ot-rbac';

describe('ipd-ot-rbac / P0-26, P0-27, P0-28', () => {
  it('exports all expected permission identifiers', () => {
    const expected: RbacPermission[] = [
      'ot.booking.create',
      'ot.booking.cancel',
      'ot.consent.record',
      'ot.vitals.record',
      'ot.inventory.use',
      'ot.notes.write',
      'ot.anesthesia.record',
      'ot.summary.finalize',
      'ot.billing.post',
      'nursing.intake.record',
      'nursing.output.record',
      'nursing.vitals.record',
      'nursing.notes.write',
      'cssd.cycle.start',
      'cssd.cycle.complete',
      'cssd.cycle.release',
      'cssd.sterile.issue',
      'cssd.used.receive',
    ];
    for (const p of expected) {
      expect(IPD_OT_NURSING_PERMISSIONS).toContain(p);
    }
  });

  it('grants access to admin roles for every permission', () => {
    const samples: RbacPermission[] = [
      'ot.booking.create',
      'ot.anesthesia.record',
      'nursing.notes.write',
      'cssd.cycle.start',
    ];
    for (const p of samples) {
      expect(hasPermission('hospital_admin', p)).toBe(true);
      expect(hasPermission('super_admin', p)).toBe(true);
    }
  });

  it('rejects unknown role', () => {
    expect(hasPermission(null, 'ot.booking.create')).toBe(false);
    expect(hasPermission(undefined, 'ot.booking.create')).toBe(false);
    expect(hasPermission('unknown_role', 'ot.booking.create')).toBe(false);
  });

  it('nursing permissions require a nursing/doctor/admin role', () => {
    expect(hasPermission('nurse', 'nursing.notes.write')).toBe(true);
    expect(hasPermission('doctor', 'nursing.notes.write')).toBe(true);
    expect(hasPermission('reception', 'nursing.notes.write')).toBe(false);
    expect(hasPermission('accountant', 'nursing.notes.write')).toBe(false);
  });

  it('CSSD cycle release is restricted to clinical staff', () => {
    expect(hasPermission('nurse', 'cssd.cycle.release')).toBe(true);
    expect(hasPermission('doctor', 'cssd.cycle.release')).toBe(true);
    expect(hasPermission('reception', 'cssd.cycle.release')).toBe(false);
  });

  it('OT billing.post is restricted to accounting roles', () => {
    expect(hasPermission('accountant', 'ot.billing.post')).toBe(true);
    expect(hasPermission('director', 'ot.billing.post')).toBe(true);
    expect(hasPermission('nurse', 'ot.billing.post')).toBe(false);
    expect(hasPermission('reception', 'ot.billing.post')).toBe(false);
  });

  it('rolesForPermission returns a non-empty role list for each permission', () => {
    for (const p of IPD_OT_NURSING_PERMISSIONS) {
      expect(rolesForPermission(p).length).toBeGreaterThan(0);
    }
  });
});

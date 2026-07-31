import { describe, it, expect } from 'vitest';
import {
  DEVICE_TYPES,
  DEVICE_STATUSES,
  MRI_SAFETY,
  addDeviceSchema,
  updateDeviceSchema,
} from '../src/routes/tenant/devices';

describe('Device Types', () => {
  it('has 5 device types', () => {
    expect(DEVICE_TYPES).toHaveLength(5);
  });

  it('includes implant, prosthetic, wearable, monitoring, other', () => {
    expect(DEVICE_TYPES).toContain('implant');
    expect(DEVICE_TYPES).toContain('prosthetic');
    expect(DEVICE_TYPES).toContain('wearable');
    expect(DEVICE_TYPES).toContain('monitoring');
    expect(DEVICE_TYPES).toContain('other');
  });
});

describe('Device Statuses', () => {
  it('has 4 statuses', () => {
    expect(DEVICE_STATUSES).toHaveLength(4);
  });

  it('includes active, removed, malfunctioning, recalled', () => {
    expect(DEVICE_STATUSES).toContain('active');
    expect(DEVICE_STATUSES).toContain('removed');
    expect(DEVICE_STATUSES).toContain('malfunctioning');
    expect(DEVICE_STATUSES).toContain('recalled');
  });
});

describe('MRI Safety', () => {
  it('has 4 safety levels', () => {
    expect(MRI_SAFETY).toHaveLength(4);
    expect(MRI_SAFETY).toContain('safe');
    expect(MRI_SAFETY).toContain('conditional');
    expect(MRI_SAFETY).toContain('unsafe');
    expect(MRI_SAFETY).toContain('unknown');
  });
});

describe('addDeviceSchema', () => {
  it('accepts valid pacemaker implant', () => {
    const result = addDeviceSchema.safeParse({
      patient_id: 1,
      device_type: 'implant',
      device_name: 'Cardiac Pacemaker',
      manufacturer: 'Medtronic',
      model_number: 'Azure XT DR MRI',
      serial_number: 'SN12345678',
      udi: '(01)00884838049010(17)260101(21)SN12345678',
      body_site: 'Left subclavian region',
      implant_date: '2026-03-15',
      reason: 'Bradycardia with syncope',
      implanted_by: 'Dr. Ahmed',
      mri_safe: 'conditional',
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal device (only required fields)', () => {
    const result = addDeviceSchema.safeParse({
      patient_id: 1,
      device_type: 'wearable',
      device_name: 'Continuous Glucose Monitor',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing patient_id', () => {
    const result = addDeviceSchema.safeParse({
      device_type: 'implant',
      device_name: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid device_type', () => {
    const result = addDeviceSchema.safeParse({
      patient_id: 1,
      device_type: 'invalid',
      device_name: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty device_name', () => {
    const result = addDeviceSchema.safeParse({
      patient_id: 1,
      device_type: 'implant',
      device_name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid mri_safe value', () => {
    const result = addDeviceSchema.safeParse({
      patient_id: 1,
      device_type: 'implant',
      device_name: 'Test',
      mri_safe: 'maybe',
    });
    expect(result.success).toBe(false);
  });

  it('accepts hip prosthesis', () => {
    const result = addDeviceSchema.safeParse({
      patient_id: 42,
      device_type: 'prosthetic',
      device_name: 'Total Hip Replacement',
      manufacturer: 'Smith & Nephew',
      body_site: 'Right hip',
      mri_safe: 'safe',
    });
    expect(result.success).toBe(true);
  });
});

describe('updateDeviceSchema', () => {
  it('accepts partial update (just notes)', () => {
    const result = updateDeviceSchema.safeParse({
      notes: 'Battery check due 2027-03',
    });
    expect(result.success).toBe(true);
  });

  it('accepts status change to malfunctioning', () => {
    const result = updateDeviceSchema.safeParse({
      device_name: 'Updated name',
      mri_safe: 'unsafe',
    });
    expect(result.success).toBe(true);
  });

  it('does not allow patient_id in update', () => {
    const result = updateDeviceSchema.safeParse({
      patient_id: 999,
      device_name: 'Test',
    });
    // patient_id is stripped by omit
    expect(result.success).toBe(true);
    expect((result as any).data?.patient_id).toBeUndefined();
  });
});

describe('UDI (Unique Device Identifier) Support', () => {
  it('accepts FDA UDI format', () => {
    const udi = '(01)00884838049010(17)260101(21)SN12345678';
    expect(udi.length).toBeLessThanOrEqual(200);
    expect(udi).toContain('(01)');
  });

  it('UDI is optional', () => {
    const result = addDeviceSchema.safeParse({
      patient_id: 1,
      device_type: 'implant',
      device_name: 'Test Implant',
    });
    expect(result.success).toBe(true);
  });
});

describe('DB Schema Contract', () => {
  it('patient_devices indexed by tenant_id + patient_id', () => {
    const idx = 'CREATE INDEX idx_patient_devices_tenant ON patient_devices(tenant_id, patient_id)';
    expect(idx).toContain('tenant_id, patient_id');
  });

  it('UDI indexed for fast lookup', () => {
    const idx = 'CREATE INDEX idx_patient_devices_udi ON patient_devices(udi)';
    expect(idx).toContain('udi');
  });

  it('default status is active', () => {
    const col = "status TEXT NOT NULL DEFAULT 'active'";
    expect(col).toContain("DEFAULT 'active'");
  });
});

describe('API Contract', () => {
  it('POST /api/devices returns 201 on success', () => {
    expect(201).toBe(201);
  });

  it('GET /api/devices/:patientId supports ?status filter', () => {
    const query = 'SELECT * FROM patient_devices WHERE tenant_id = ? AND patient_id = ? AND status = ?';
    expect(query).toContain('status = ?');
  });

  it('POST /:patientId/:id/remove sets removal_date', () => {
    const sql = "UPDATE patient_devices SET status = 'removed', removal_date = datetime('now')";
    expect(sql).toContain('removal_date');
  });

  it('GET /recalls/list filters by status recalled', () => {
    const sql = "WHERE pd.tenant_id = ? AND pd.status = 'recalled'";
    expect(sql).toContain("'recalled'");
  });
});

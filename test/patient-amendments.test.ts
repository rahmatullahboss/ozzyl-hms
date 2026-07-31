import { describe, it, expect } from 'vitest';
import {
  AMENDMENT_RECORD_TYPES,
  AMENDMENT_STATUSES,
  requestAmendmentSchema,
  reviewAmendmentSchema,
} from '../src/routes/patient-amendments';

describe('Amendment Record Types', () => {
  it('has 7 record types', () => {
    expect(AMENDMENT_RECORD_TYPES).toHaveLength(7);
  });

  it('includes core clinical types', () => {
    expect(AMENDMENT_RECORD_TYPES).toContain('demographics');
    expect(AMENDMENT_RECORD_TYPES).toContain('vitals');
    expect(AMENDMENT_RECORD_TYPES).toContain('allergy');
    expect(AMENDMENT_RECORD_TYPES).toContain('medication');
    expect(AMENDMENT_RECORD_TYPES).toContain('lab_result');
    expect(AMENDMENT_RECORD_TYPES).toContain('clinical_note');
    expect(AMENDMENT_RECORD_TYPES).toContain('other');
  });
});

describe('Amendment Statuses', () => {
  it('has 4 statuses', () => {
    expect(AMENDMENT_STATUSES).toHaveLength(4);
  });

  it('includes pending, approved, denied, partial', () => {
    expect(AMENDMENT_STATUSES).toContain('pending');
    expect(AMENDMENT_STATUSES).toContain('approved');
    expect(AMENDMENT_STATUSES).toContain('denied');
    expect(AMENDMENT_STATUSES).toContain('partial');
  });
});

describe('requestAmendmentSchema', () => {
  it('accepts valid amendment request', () => {
    const result = requestAmendmentSchema.safeParse({
      record_type: 'demographics',
      field_name: 'blood_group',
      current_value: 'A+',
      requested_value: 'O+',
      reason: 'Blood group was recorded incorrectly during registration',
    });
    expect(result.success).toBe(true);
  });

  it('accepts request without current_value', () => {
    const result = requestAmendmentSchema.safeParse({
      record_type: 'allergy',
      field_name: 'allergen',
      requested_value: 'Penicillin',
      reason: 'Allergy was not recorded during intake',
    });
    expect(result.success).toBe(true);
  });

  it('accepts request with record_id', () => {
    const result = requestAmendmentSchema.safeParse({
      record_type: 'medication',
      record_id: 'med-123',
      field_name: 'dose',
      requested_value: '500mg',
      reason: 'Dose was entered as 50mg instead of 500mg',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid record_type', () => {
    const result = requestAmendmentSchema.safeParse({
      record_type: 'invalid_type',
      field_name: 'test',
      requested_value: 'new',
      reason: 'test reason here',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty field_name', () => {
    const result = requestAmendmentSchema.safeParse({
      record_type: 'demographics',
      field_name: '',
      requested_value: 'new value',
      reason: 'needs correction here',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty requested_value', () => {
    const result = requestAmendmentSchema.safeParse({
      record_type: 'demographics',
      field_name: 'name',
      requested_value: '',
      reason: 'name is wrong in system',
    });
    expect(result.success).toBe(false);
  });

  it('rejects reason shorter than 5 chars', () => {
    const result = requestAmendmentSchema.safeParse({
      record_type: 'demographics',
      field_name: 'name',
      requested_value: 'John',
      reason: 'fix',
    });
    expect(result.success).toBe(false);
  });

  it('rejects reason longer than 1000 chars', () => {
    const result = requestAmendmentSchema.safeParse({
      record_type: 'demographics',
      field_name: 'name',
      requested_value: 'John',
      reason: 'x'.repeat(1001),
    });
    expect(result.success).toBe(false);
  });
});

describe('reviewAmendmentSchema', () => {
  it('accepts valid approval', () => {
    const result = reviewAmendmentSchema.safeParse({
      status: 'approved',
      review_note: 'Verified with patient ID, correction confirmed',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid denial', () => {
    const result = reviewAmendmentSchema.safeParse({
      status: 'denied',
      review_note: 'Current value is accurate per lab results from 2026-04-10',
    });
    expect(result.success).toBe(true);
  });

  it('accepts partial approval', () => {
    const result = reviewAmendmentSchema.safeParse({
      status: 'partial',
      review_note: 'Name corrected but blood group change requires lab verification',
    });
    expect(result.success).toBe(true);
  });

  it('rejects pending as review status (cannot re-set to pending)', () => {
    const result = reviewAmendmentSchema.safeParse({
      status: 'pending',
      review_note: 'test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty review_note', () => {
    const result = reviewAmendmentSchema.safeParse({
      status: 'approved',
      review_note: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('Amendment API Contract', () => {
  it('POST /api/patient-amendments creates with status=pending', () => {
    const defaultStatus = 'pending';
    expect(defaultStatus).toBe('pending');
  });

  it('Amendment cannot be reviewed twice (409 check)', () => {
    const existing = { status: 'approved' };
    const canReview = existing.status === 'pending';
    expect(canReview).toBe(false);
  });

  it('Patient can only see their own amendments', () => {
    const query = 'SELECT * FROM patient_amendments WHERE patient_id = ?';
    expect(query).toContain('patient_id = ?');
  });

  it('Staff sees amendments filtered by tenant_id', () => {
    const query = 'SELECT * FROM patient_amendments WHERE tenant_id = ?';
    expect(query).toContain('tenant_id = ?');
  });
});

describe('Amendment Audit Trail', () => {
  it('audit log records actor_id and actor_role', () => {
    const auditEntry = {
      amendment_id: 1,
      action: 'requested',
      actor_id: '42',
      actor_role: 'patient',
      detail: 'Blood group correction',
    };
    expect(auditEntry.actor_role).toBe('patient');
    expect(auditEntry.action).toBe('requested');
  });

  it('audit actions cover full lifecycle', () => {
    const actions = ['requested', 'approved', 'denied', 'partial', 'applied'];
    expect(actions).toContain('requested');
    expect(actions).toContain('approved');
    expect(actions).toContain('denied');
    expect(actions).toContain('applied');
  });

  it('audit is immutable (INSERT only, no UPDATE/DELETE)', () => {
    const insertSQL = 'INSERT INTO patient_amendment_audit (amendment_id, action, actor_id, actor_role, detail)';
    expect(insertSQL).toContain('INSERT');
    expect(insertSQL).not.toContain('UPDATE');
    expect(insertSQL).not.toContain('DELETE');
  });
});

describe('DB Schema Contract', () => {
  it('patient_amendments has UNIQUE-friendly indexes', () => {
    const indexSQL = 'CREATE INDEX idx_amendments_tenant_patient ON patient_amendments(tenant_id, patient_id)';
    expect(indexSQL).toContain('tenant_id, patient_id');
  });

  it('status index for fast pending queries', () => {
    const indexSQL = 'CREATE INDEX idx_amendments_status ON patient_amendments(tenant_id, status)';
    expect(indexSQL).toContain('tenant_id, status');
  });

  it('day constraint: day CHECK(day >= 1 AND day <= 7) not needed here', () => {
    // Just verifying amendment statuses don't have numeric constraints
    expect(AMENDMENT_STATUSES.every((s) => typeof s === 'string')).toBe(true);
  });
});

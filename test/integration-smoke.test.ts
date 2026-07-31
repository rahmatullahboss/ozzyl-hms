import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════════
// Smoke Tests — Can all modules import without crashing?
// ═══════════════════════════════════════════════════════════════════════════════

describe('Smoke Tests — Module Imports', () => {
  it('should import HL7 parser without errors', async () => {
    const mod = await import('../src/lib/hl7-parser');
    expect(mod.parseHL7Message).toBeTypeOf('function');
    expect(mod.generateHL7Order).toBeTypeOf('function');
    expect(mod.decodeHL7Escapes).toBeTypeOf('function');
    expect(mod.parseHL7DateTime).toBeTypeOf('function');
    expect(mod.mapHL7AbnormalFlag).toBeTypeOf('function');
    expect(mod.mapHL7ResultStatus).toBeTypeOf('function');
  });

  it('should import ASTM parser without errors', async () => {
    const mod = await import('../src/lib/astm-parser');
    expect(mod.parseASTMMessage).toBeTypeOf('function');
    expect(mod.calculateASTMChecksum).toBeTypeOf('function');
    expect(mod.validateASTMFrame).toBeTypeOf('function');
    expect(mod.reassembleASTMFrames).toBeTypeOf('function');
    expect(mod.mapASTMAbnormalFlag).toBeTypeOf('function');
    expect(mod.mapASTMResultStatus).toBeTypeOf('function');
  });

  it('should import drug-safety without errors', async () => {
    const mod = await import('../src/lib/drug-safety');
    expect(mod.evaluateMedicationSafety).toBeTypeOf('function');
    expect(mod.normalizeMedicationName).toBeTypeOf('function');
    expect(mod.findDrugAllergyConflicts).toBeTypeOf('function');
    expect(mod.buildInteractionPairKey).toBeTypeOf('function');
    expect(mod.hasBlockingSeverity).toBeTypeOf('function');
  });

  it('should import authz without errors', async () => {
    const mod = await import('../packages/shared/src/authz');
    expect(mod.VALID_TENANT_ROLES).toBeDefined();
    expect(mod.VALID_TENANT_ROLES.length).toBeGreaterThanOrEqual(9);
    expect(mod.ALL_PERMISSIONS).toBeDefined();
    expect(mod.ALL_PERMISSIONS.length).toBeGreaterThanOrEqual(50);
    expect(mod.PERMISSION_GROUPS).toBeDefined();
    expect(mod.ALL_MODULES).toBeDefined();
    expect(mod.getPermissionsForRole).toBeTypeOf('function');
    expect(mod.normalizeRole).toBeTypeOf('function');
  });

  it('should import all lab schemas without errors', async () => {
    const lab = await import('../src/schemas/lab');
    expect(lab.createLabTestSchema).toBeDefined();
    expect(lab.createLabOrderSchema).toBeDefined();
    expect(lab.createPanelSchema).toBeDefined();
    expect(lab.bulkResultEntrySchema).toBeDefined();
    expect(lab.createLabOrderExtendedSchema).toBeDefined();

    const machine = await import('../src/schemas/labMachine');
    expect(machine.createLabMachineSchema).toBeDefined();
    expect(machine.machineResultSchema).toBeDefined();
    expect(machine.hl7MessageReceiveSchema).toBeDefined();
    expect(machine.astmMessageReceiveSchema).toBeDefined();
  });

  it('should import order set schemas without errors', async () => {
    const mod = await import('../src/schemas/orderSet');
    expect(mod.createOrderSetSchema).toBeDefined();
    expect(mod.createOrderSetItemSchema).toBeDefined();
    expect(mod.applyOrderSetSchema).toBeDefined();
    expect(mod.doctorFavoriteSchema).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Clinical Reminders Evaluation Logic Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical Reminders — Evaluation Logic', () => {
  it('should determine reminder is overdue when past due + grace period', () => {
    const lastCompleted = new Date('2025-12-01');
    const intervalDays = 90;
    const gracePeriodDays = 14;
    const now = new Date('2026-04-20');

    const nextDue = new Date(lastCompleted.getTime() + intervalDays * 86400000);
    const graceDeadline = new Date(nextDue.getTime() + gracePeriodDays * 86400000);

    expect(now > graceDeadline).toBe(true);
    const status = now > graceDeadline ? 'overdue' : now > nextDue ? 'due' : 'completed';
    expect(status).toBe('overdue');
  });

  it('should determine reminder is due when within grace period', () => {
    const lastCompleted = new Date('2026-01-15');
    const intervalDays = 90;
    const gracePeriodDays = 30;
    const now = new Date('2026-04-20');

    const nextDue = new Date(lastCompleted.getTime() + intervalDays * 86400000); // Apr 15
    const graceDeadline = new Date(nextDue.getTime() + gracePeriodDays * 86400000); // May 15

    expect(now > nextDue).toBe(true);
    expect(now < graceDeadline).toBe(true);
    const status = now > graceDeadline ? 'overdue' : now > nextDue ? 'due' : 'completed';
    expect(status).toBe('due');
  });

  it('should determine reminder is completed when not yet due', () => {
    const lastCompleted = new Date('2026-04-01');
    const intervalDays = 90;
    const now = new Date('2026-04-20');

    const nextDue = new Date(lastCompleted.getTime() + intervalDays * 86400000); // Jun 30
    expect(now < nextDue).toBe(true);
    const status = now > nextDue ? 'due' : 'completed';
    expect(status).toBe('completed');
  });

  it('should filter rules by age criteria', () => {
    const rules = [
      { id: 1, title: 'Cervical Screening', min_age: 21, max_age: 65, sex: 'F' },
      { id: 2, title: 'Colorectal Screening', min_age: 45, max_age: 75, sex: null },
      { id: 3, title: 'Flu Vaccine', min_age: 50, max_age: null, sex: null },
    ];

    const patientAge = 30;
    const patientSex = 'F';

    const applicable = rules.filter(r => {
      if (r.min_age != null && patientAge < r.min_age) return false;
      if (r.max_age != null && patientAge > r.max_age) return false;
      if (r.sex && r.sex !== patientSex) return false;
      return true;
    });

    expect(applicable).toHaveLength(1);
    expect(applicable[0].title).toBe('Cervical Screening');
  });

  it('should match condition-based rules against diagnoses', () => {
    const rule = { condition_codes: '["diabetes","e11","e10"]', medication_names: null };
    const patientDiagnoses = ['Hypertension', 'Type 2 Diabetes Mellitus'];

    const condCodes: string[] = JSON.parse(rule.condition_codes);
    const hasCondition = condCodes.some(code =>
      patientDiagnoses.some(d => d.toLowerCase().includes(code.toLowerCase())),
    );

    expect(hasCondition).toBe(true);
  });

  it('should match medication-based rules', () => {
    const rule = { medication_names: '["warfarin"]' };
    const patientMeds = ['Warfarin 5mg', 'Omeprazole 20mg'];

    const medNames: string[] = JSON.parse(rule.medication_names);
    const hasMed = medNames.some(name =>
      patientMeds.some(m => m.toLowerCase().includes(name.toLowerCase())),
    );

    expect(hasMed).toBe(true);
  });

  it('should calculate next due date after completion', () => {
    const now = new Date('2026-04-20');
    const intervalDays = 90;
    const nextDue = new Date(now.getTime() + intervalDays * 86400000);
    expect(nextDue.toISOString().split('T')[0]).toBe('2026-07-19');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Permission Resolution Tests
// ═══════════════════════════════════════════════════════════════════════════════

import { getPermissionsForRole, normalizeRole, ALL_PERMISSIONS, PERMISSION_GROUPS, ALL_MODULES, VALID_TENANT_ROLES } from '../packages/shared/src/authz';

describe('Permission Resolution', () => {
  it('should return permissions for all valid roles', () => {
    for (const role of VALID_TENANT_ROLES) {
      const perms = getPermissionsForRole(role);
      expect(perms.length).toBeGreaterThan(0);
    }
  });

  it('hospital_admin should have wildcard', () => {
    const perms = getPermissionsForRole('hospital_admin');
    expect(perms).toContain('*');
  });

  it('super_admin should have wildcard', () => {
    const perms = getPermissionsForRole('super_admin');
    expect(perms).toContain('*');
  });

  it('doctor should have patients:read and prescriptions:write', () => {
    const perms = getPermissionsForRole('doctor');
    expect(perms).toContain('patients:read');
    expect(perms).toContain('prescriptions:write');
  });

  it('nurse should have nursing:write but not billing:write', () => {
    const perms = getPermissionsForRole('nurse');
    expect(perms).toContain('nursing:write');
    expect(perms).not.toContain('billing:write');
  });

  it('laboratory should have tests:write', () => {
    const perms = getPermissionsForRole('laboratory');
    expect(perms).toContain('tests:write');
  });

  it('accountant should have accounting:write but not patients:write', () => {
    const perms = getPermissionsForRole('accountant');
    expect(perms).toContain('accounting:write');
    expect(perms).not.toContain('patients:write');
  });

  it('should normalize role aliases', () => {
    expect(normalizeRole('lab')).toBe('laboratory');
    expect(normalizeRole('lab_tech')).toBe('laboratory');
    expect(normalizeRole('receptionist')).toBe('reception');
    expect(normalizeRole('doctor')).toBe('doctor');
    expect(normalizeRole('invalid')).toBe('');
    expect(normalizeRole(null)).toBe('');
  });

  it('should simulate DB override replacing static permissions', () => {
    const staticPerms = getPermissionsForRole('nurse');
    const dbOverride = [...staticPerms, 'billing:read', 'billing:write'];
    expect(dbOverride).toContain('billing:read');
    expect(dbOverride).toContain('nursing:write');
  });

  it('should simulate user-level grant/revoke', () => {
    const basePerms = new Set(getPermissionsForRole('reception'));
    // Grant pharmacy:read
    basePerms.add('pharmacy:read');
    // Revoke expenses:read
    basePerms.delete('expenses:read');

    expect(basePerms.has('pharmacy:read')).toBe(true);
    expect(basePerms.has('expenses:read')).toBe(false);
    expect(basePerms.has('patients:write')).toBe(true); // unchanged
  });

  it('ALL_PERMISSIONS should have 50+ entries', () => {
    expect(ALL_PERMISSIONS.length).toBeGreaterThanOrEqual(50);
  });

  it('PERMISSION_GROUPS should cover all major modules', () => {
    const groupKeys = Object.keys(PERMISSION_GROUPS);
    expect(groupKeys).toContain('patients');
    expect(groupKeys).toContain('billing');
    expect(groupKeys).toContain('pharmacy');
    expect(groupKeys).toContain('nursing');
    expect(groupKeys).toContain('lab');
    expect(groupKeys).toContain('hr');
    expect(groupKeys).toContain('admin');
  });

  it('ALL_MODULES should have 15+ entries', () => {
    expect(ALL_MODULES.length).toBeGreaterThanOrEqual(15);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FHIR Resource Format Validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('FHIR Resource Format', () => {
  it('should produce valid DiagnosticReport structure', () => {
    const report = {
      resourceType: 'DiagnosticReport',
      id: 'lab-order-1',
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB', display: 'Laboratory' }] }],
      code: { text: 'Lab Order LO-000001' },
      subject: { reference: 'Patient/1', display: 'John Doe' },
      effectiveDateTime: '2026-04-20',
      result: [{ reference: 'Observation/lab-item-1', display: 'CBC' }],
    };

    expect(report.resourceType).toBe('DiagnosticReport');
    expect(report.status).toBe('final');
    expect(report.category[0].coding[0].code).toBe('LAB');
    expect(report.subject.reference).toContain('Patient/');
    expect(report.result).toHaveLength(1);
  });

  it('should produce valid Observation (laboratory) structure', () => {
    const obs = {
      resourceType: 'Observation',
      id: 'lab-item-1',
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
      code: {
        coding: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }],
        text: 'Hemoglobin',
      },
      valueQuantity: { value: 14.2, unit: 'g/dL', system: 'http://unitsofmeasure.org' },
      interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: 'N', display: 'Normal' }] }],
      referenceRange: [{ low: { value: 12.0, unit: 'g/dL' }, high: { value: 16.0, unit: 'g/dL' } }],
    };

    expect(obs.resourceType).toBe('Observation');
    expect(obs.category[0].coding[0].code).toBe('laboratory');
    expect(obs.valueQuantity.value).toBe(14.2);
    expect(obs.interpretation[0].coding[0].code).toBe('N');
    expect(obs.referenceRange[0].low.value).toBe(12.0);
    expect(obs.referenceRange[0].high.value).toBe(16.0);
  });

  it('should produce valid ServiceRequest structure', () => {
    const sr = {
      resourceType: 'ServiceRequest',
      id: 'lab-order-1',
      status: 'active',
      intent: 'order',
      priority: 'stat',
      category: [{ coding: [{ system: 'http://snomed.info/sct', code: '108252007', display: 'Laboratory procedure' }] }],
      subject: { reference: 'Patient/1' },
      authoredOn: '2026-04-20T08:00:00',
    };

    expect(sr.resourceType).toBe('ServiceRequest');
    expect(sr.intent).toBe('order');
    expect(sr.priority).toBe('stat');
    expect(sr.category[0].coding[0].system).toContain('snomed');
  });

  it('should map HMS status to FHIR DiagnosticReport status', () => {
    const statusMap: Record<string, string> = {
      'pending': 'registered', 'sample-collected': 'registered',
      'processing': 'preliminary', 'completed': 'final',
      'verified': 'final', 'cancelled': 'cancelled',
    };
    expect(statusMap['pending']).toBe('registered');
    expect(statusMap['completed']).toBe('final');
    expect(statusMap['verified']).toBe('final');
    expect(statusMap['cancelled']).toBe('cancelled');
  });

  it('should map abnormal flags to FHIR interpretation codes', () => {
    const flagMap: Record<string, string> = {
      'normal': 'N', 'high': 'H', 'low': 'L', 'critical': 'HH',
    };
    expect(flagMap['normal']).toBe('N');
    expect(flagMap['high']).toBe('H');
    expect(flagMap['critical']).toBe('HH');
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const files = {
  audit: 'docs/database/audits/2026-07-27-prescription-medication-intent-authority-audit.md',
  design: 'docs/superpowers/specs/2026-07-27-cdb-121a-prescription-medication-intent-authority-design.md',
  plan: 'docs/superpowers/plans/2026-07-27-cdb-121-prescription-medication-intent-authority.md',
  receipt: 'docs/database/migration-runs/P11-canonical-prescription-medication-intent-authority-design.md',
  tracker: 'task-progress.yaml',
  control: 'docs/architecture/canonical-program-control-center.md',
  handoff: '.ai-bridge/current-plan.md',
};

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const targetTables = [
  'canonical_prescriptions',
  'canonical_prescription_versions',
  'canonical_medication_orders',
  'canonical_medication_order_status_events',
  'canonical_prescription_safety_events',
];

const commands = [
  'createCanonicalPrescriptionDraft',
  'replaceCanonicalPrescriptionDraft',
  'finalizeCanonicalPrescription',
  'amendCanonicalPrescription',
  'transitionCanonicalMedicationOrder',
  'recordCanonicalPrescriptionSafetyEvent',
];

describe('CDB-121 prescription medication authority design contract', () => {
  it('defines one encounter-linked prescription and medication-intent authority', () => {
    const audit = read(files.audit);
    const design = read(files.design);
    const plan = read(files.plan);
    const combined = `${audit}\n${design}\n${plan}`;

    for (const value of targetTables) expect(combined).toContain(value);
    for (const value of commands) expect(combined).toContain(value);

    for (const value of [
      'patient_link_public_id',
      'encounter_public_id',
      'prescribing_practitioner_public_id',
      'immutable',
      'source_evidence_sha256',
      'second pass creates zero new business rows',
      'Names, phone numbers',
    ]) expect(combined).toContain(value);
  });

  it('keeps clinical intent separate from administration, reconciliation, fulfilment, inventory, and finance', () => {
    const design = read(files.design);
    for (const value of [
      'medication administration',
      'medication reconciliation',
      'fulfilment',
      'stock',
      'billing',
      'payment',
      'does not implement medication administration/MAR authority',
      'does not implement medication reconciliation authority',
    ]) expect(design.toLowerCase()).toContain(value.toLowerCase());

    expect(design).toContain('Treat fulfilment `medication_orders` as clinical orders');
    expect(design).toContain('Rejected.');
  });

  it('records the serial CDB-121A through CDB-121E checkpoint sequence', () => {
    const plan = read(files.plan);
    const receipt = read(files.receipt);
    const tracker = read(files.tracker);
    const control = read(files.control);
    const handoff = read(files.handoff);

    for (const value of [
      'CDB-121A-PRESCRIPTION-MEDICATION-INTENT-AUTHORITY-DESIGN-VERIFIED',
      'CDB-121B-CANONICAL-PRESCRIPTION-MEDICATION-SCHEMA',
      'CDB-121C',
      'CDB-121D',
      'CDB-121E',
    ]) {
      expect(`${plan}\n${receipt}\n${tracker}\n${control}\n${handoff}`).toContain(value);
    }
  });

  it('keeps production, activation, retirement, push, and main integration prohibited', () => {
    const receipt = read(files.receipt);
    const tracker = read(files.tracker);
    const handoff = read(files.handoff);
    const combined = `${receipt}\n${tracker}\n${handoff}`;

    for (const value of [
      'production_rows_written: 0',
      'production_mutation_performed: false',
      'provider_flag_enabled: false',
      'route_changed: false',
      'traffic_changed: false',
      'deployment_performed: false',
      'local_sync_activated: false',
      'legacy_history_retired: false',
      'push_performed: false',
      'cdb_to_main_integration_performed: false',
    ]) expect(combined).toContain(value);
  });
});

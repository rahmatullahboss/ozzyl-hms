import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const files = {
  audit: 'docs/database/audits/2026-07-27-clinical-document-diagnosis-authority-audit.md',
  design: 'docs/superpowers/specs/2026-07-27-cdb-122a-clinical-document-diagnosis-authority-design.md',
  plan: 'docs/superpowers/plans/2026-07-27-cdb-122-clinical-document-diagnosis-authority.md',
  receipt: 'docs/database/migration-runs/P11-canonical-clinical-document-diagnosis-authority-design.md',
  tracker: 'task-progress.yaml',
  control: 'docs/architecture/canonical-program-control-center.md',
  handoff: '.ai-bridge/current-plan.md',
};

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

const targetTables = [
  'canonical_clinical_documents',
  'canonical_clinical_document_versions',
  'canonical_clinical_document_signatures',
  'canonical_clinical_document_attachments',
  'canonical_diagnosis_assertions',
  'canonical_diagnosis_status_events',
];

const commands = [
  'createCanonicalClinicalDocumentDraft',
  'replaceCanonicalClinicalDocumentDraft',
  'signCanonicalClinicalDocument',
  'amendCanonicalClinicalDocument',
  'enterCanonicalClinicalDocumentInError',
  'attachCanonicalClinicalDocumentArtifact',
  'assertCanonicalDiagnosis',
  'reviewCanonicalDiagnosis',
  'transitionCanonicalDiagnosis',
];

describe('CDB-122 clinical document and diagnosis authority design contract', () => {
  it('defines separate document/version/signature/attachment and diagnosis/event authorities', () => {
    const audit = read(files.audit);
    const design = read(files.design);
    const plan = read(files.plan);
    const combined = `${audit}\n${design}\n${plan}`;

    for (const value of targetTables) expect(combined).toContain(value);
    for (const value of commands) expect(combined).toContain(value);
    for (const value of [
      'patient_link_public_id',
      'encounter_public_id',
      'authoring_practitioner_public_id',
      'content_sha256',
      'immutable',
      'second pass creates zero new business rows',
      'Names, phone numbers',
      'narrative text never creates a diagnosis automatically',
    ]) expect(combined.toLowerCase()).toContain(value.toLowerCase());
  });

  it('reuses encounter addenda and keeps adjacent authorities separate', () => {
    const audit = read(files.audit);
    const design = read(files.design);
    const combined = `${audit}\n${design}`;

    expect(combined).toContain('canonical_encounter_addenda');
    expect(combined).toContain('do not create a duplicate Canonical document-addendum table');
    expect(design).toContain('Create a second Canonical encounter-addendum table');
    expect(design).toContain('Rejected.');

    for (const value of [
      'longitudinal problem-list authority',
      'questionnaire/observation authority',
      'observation/vital authority',
      'prescription and medication orders',
      'diagnostic order/result authority',
      'medical-record filing',
      'billing',
      'payment',
    ]) expect(combined.toLowerCase()).toContain(value.toLowerCase());
  });

  it('records the serial CDB-122A through CDB-122E sequence and schema-only next action', () => {
    const plan = read(files.plan);
    const receipt = read(files.receipt);
    const tracker = read(files.tracker);
    const control = read(files.control);
    const handoff = read(files.handoff);
    const combined = `${plan}\n${receipt}\n${tracker}\n${control}\n${handoff}`;

    for (const value of [
      'CDB-122A-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-DESIGN-VERIFIED',
      'CDB-122B-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-SCHEMA',
      'CDB-122C-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-COMMANDS-VERIFIED',
      'CDB-122D-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-BACKFILL-RECONCILIATION-VERIFIED',
      'CDB-122E-CANONICAL-CLINICAL-DOCUMENT-DIAGNOSIS-AUTHORITY-VERIFIED',
    ]) expect(combined).toContain(value);

    expect(receipt).toContain('design_runtime_files_created: 0');
    expect(receipt).toContain('schema_migrations_created: 0');
    expect(receipt).toContain('Do not implement runtime commands, backfill, provider activation, or production changes in the schema checkpoint.');
  });

  it('keeps production, activation, retirement, push, and main integration prohibited', () => {
    const receipt = read(files.receipt);
    const tracker = read(files.tracker);
    const handoff = read(files.handoff);
    const combined = `${receipt}\n${tracker}\n${handoff}`;

    for (const value of [
      'production_rows_written: 0',
      'production_query_performed: false',
      'production_mutation_performed: false',
      'production_migration_applied: false',
      'production_backfill_applied: false',
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

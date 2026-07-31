import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = new URL('../migrations/0362_doctor_ipd_round_notes.sql', import.meta.url);
const tenantSchemaPath = new URL('../tenant-schema.sql', import.meta.url);
const drizzleSchemaPath = new URL('../src/db/schema/schema.ts', import.meta.url);

function readIfPresent(path: URL): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('IPD doctor round clinical note schema', () => {
  it('adds clinical-note linkage columns and indexes to ipd_doctor_rounds', () => {
    const migration = readIfPresent(migrationPath);

    expect(migration).toMatch(/clinical_note_id\s+INTEGER/i);
    expect(migration).toMatch(
      /clinical_status\s+TEXT\s+NOT NULL DEFAULT 'billing_only'[\s\S]+CHECK \(clinical_status IN \('billing_only', 'documented', 'signed', 'cancelled'\)\)/i,
    );
    expect(migration).toMatch(/signed_by\s+INTEGER/i);
    expect(migration).toMatch(/signed_at\s+TEXT/i);
    expect(migration).toMatch(/round_summary\s+TEXT/i);
    expect(migration).toMatch(
      /patient_condition\s+TEXT[\s\S]+CHECK \(patient_condition IS NULL OR patient_condition IN \('improving', 'stable', 'deteriorating', 'critical'\)\)/i,
    );
    expect(migration).toContain('idx_ipd_doctor_rounds_clinical_status');
    expect(migration).toContain('idx_ipd_doctor_rounds_clinical_note');
    expect(migration).toContain('idx_ipd_doctor_rounds_clinical_signed');
    expect(migration).toContain('idx_ipd_doctor_rounds_condition');
  });

  it('widens entry_source to allow doctor_dashboard while preserving existing rows', () => {
    const migration = readIfPresent(migrationPath);

    expect(migration).toContain('ipd_doctor_rounds_new');
    expect(migration).toContain(
      "CHECK (entry_source IN ('nurse_station', 'ipd_billing', 'doctor_dashboard'))",
    );
    expect(migration).toMatch(/INSERT INTO ipd_doctor_rounds_new/i);
    expect(migration).toMatch(/DROP TABLE ipd_doctor_rounds/i);
    expect(migration).toMatch(/ALTER TABLE ipd_doctor_rounds_new RENAME TO ipd_doctor_rounds/i);
    expect(migration).toMatch(/cancelled_at,\s+NULL,\s+'billing_only',\s+NULL,\s+NULL,/i);
  });

  it('rebuilds the doctor-round guard around the table replacement', () => {
    const migration = readIfPresent(migrationPath);
    const dropTriggerAt = migration.indexOf(
      'DROP TRIGGER IF EXISTS trg_doctor_round_provisional_cancel_requires_round',
    );
    const dropTableAt = migration.indexOf('DROP TABLE ipd_doctor_rounds');
    const renameTableAt = migration.indexOf(
      'ALTER TABLE ipd_doctor_rounds_new RENAME TO ipd_doctor_rounds',
    );
    const recreateTriggerAt = migration.lastIndexOf(
      'CREATE TRIGGER IF NOT EXISTS trg_doctor_round_provisional_cancel_requires_round',
    );

    expect(dropTriggerAt).toBeGreaterThanOrEqual(0);
    expect(dropTriggerAt).toBeLessThan(dropTableAt);
    expect(recreateTriggerAt).toBeGreaterThan(renameTableAt);
  });

  it('adds a dedicated clinical-note idempotency key and unique tenant index', () => {
    const migration = readIfPresent(migrationPath);
    const drizzleSchema = readFileSync(drizzleSchemaPath, 'utf8');

    expect(migration).toMatch(/ALTER TABLE clinical_notes\s+ADD COLUMN idempotency_key TEXT/i);
    expect(migration).toContain('idx_cln_notes_idempotency');
    expect(drizzleSchema).toContain('idempotencyKey: text("idempotency_key")');
    expect(drizzleSchema).toContain('uniqueIndex("idx_cln_notes_idempotency")');
  });

  it('mirrors new columns and indexes in tenant-schema.sql and drizzle schema.ts', () => {
    const tenantSchema = readFileSync(tenantSchemaPath, 'utf8');
    const drizzleSchema = readFileSync(drizzleSchemaPath, 'utf8');

    expect(tenantSchema).toContain('clinical_note_id INTEGER');
    expect(tenantSchema).toMatch(
      /clinical_status TEXT NOT NULL DEFAULT 'billing_only'[\s\S]+CHECK \(clinical_status IN \('billing_only', 'documented', 'signed', 'cancelled'\)\)/i,
    );
    expect(tenantSchema).toContain('signed_by INTEGER');
    expect(tenantSchema).toContain('signed_at TEXT');
    expect(tenantSchema).toContain('round_summary TEXT');
    expect(tenantSchema).toContain('idx_ipd_doctor_rounds_clinical_status');
    expect(tenantSchema).toContain('idx_ipd_doctor_rounds_clinical_note');
    expect(tenantSchema).toContain('idx_ipd_doctor_rounds_clinical_signed');
    expect(tenantSchema).toContain('idx_ipd_doctor_rounds_condition');
    expect(tenantSchema).toContain(
      "CHECK (entry_source IN ('nurse_station', 'ipd_billing', 'doctor_dashboard'))",
    );

    expect(drizzleSchema).toContain('clinicalNoteId: integer("clinical_note_id")');
    expect(drizzleSchema).toContain('clinicalStatus: text("clinical_status").default("billing_only").notNull()');
    expect(drizzleSchema).toContain('signedBy: integer("signed_by")');
    expect(drizzleSchema).toContain('signedAt: text("signed_at")');
    expect(drizzleSchema).toContain('roundSummary: text("round_summary")');
    expect(drizzleSchema).toContain('patientCondition: text("patient_condition")');
    expect(drizzleSchema).toContain('index("idx_ipd_doctor_rounds_clinical_status")');
    expect(drizzleSchema).toContain('index("idx_ipd_doctor_rounds_clinical_note")');
    expect(drizzleSchema).toContain('index("idx_ipd_doctor_rounds_clinical_signed")');
    expect(drizzleSchema).toContain('index("idx_ipd_doctor_rounds_condition")');
  });
});

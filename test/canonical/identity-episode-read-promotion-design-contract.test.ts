import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const files = {
  audit: 'docs/database/audits/2026-07-27-identity-episode-read-promotion-audit.md',
  plan: 'docs/superpowers/plans/2026-07-27-cdb-113f-identity-episode-read-promotion.md',
};

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('CDB-113F identity and episode read-promotion design contract', () => {
  it('keeps substantial audit and serial execution documents', () => {
    expect(fs.existsSync(path.join(root, files.audit))).toBe(true);
    expect(fs.existsSync(path.join(root, files.plan))).toBe(true);
    if (!fs.existsSync(path.join(root, files.audit)) || !fs.existsSync(path.join(root, files.plan))) return;
    expect(read(files.audit).length).toBeGreaterThan(12_000);
    expect(read(files.plan).length).toBeGreaterThan(11_000);
  });

  it('locks the exact identity and episode reader inventory', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      'Eligible identity/episode reader pairs | 616',
      'Unique source paths | 249',
      'Unique governed tables | 41',
      'Unknown provider assignments | 0',
      'Legacy reader pairs | 375',
      'Compatibility reader pairs | 53',
      'Canonical reader pairs | 102',
      'External-governed reader pairs | 86',
      'Patient identity | 178 | 136 | 10 | 13 | 19',
      'Practitioner | 187 | 80 | 8 | 32 | 67',
      'Appointment | 47 | 31 | 7 | 9 | 0',
      'Encounter | 98 | 60 | 14 | 24 | 0',
      'Admission/bed | 106 | 68 | 14 | 24 | 0',
    ]) expect(combined).toContain(text);
  });

  it('separates the five provider authority families', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      'Patient identity provider',
      'Practitioner provider',
      'Appointment provider',
      'Encounter provider',
      'Admission/bed provider',
      'planned appointment intent',
      'actual care',
      'inpatient admission lifecycle',
      'interval-based bed occupancy',
      'Authentication users and employees remain separate roles',
      'Appointment fee display data is not invoice or payment authority',
    ]) expect(combined).toContain(text);
  });

  it('requires deterministic mixed-source classification without value heuristics', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      '### `consultations`',
      'appointment/backfill/reconciliation/marketplace paths',
      'clinical consultation, patient chart, patient timeline, and encounter backfill paths',
      'timestamps or status text alone',
      '`visits` maps to encounter',
      'phone/name matching',
      'numeric-ID coincidence',
      'timestamp proximity',
    ]) expect(combined).toContain(text);
  });

  it('records disabled-safe provider adoption and the patient-provider gap', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      '`src/lib/canonical/practitioner-provider.ts`',
      '`src/lib/canonical/appointment-provider.ts`',
      '`src/lib/canonical/encounter-provider.ts`',
      '`src/lib/canonical/admission-bed-provider.ts`',
      'The missing provider is patient identity',
      '`canonical_patient_identity_provider_v1`',
      'absent/disabled/malformed/unsupported flag: `legacy`',
      'No production or environment flag is changed',
    ]) expect(combined).toContain(text);
  });

  it('defines PHI-minimised shadow evidence and stable variance classes', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      'aggregate evidence only',
      'stable variance IDs',
      '`MAPPING_MISSING`',
      '`MAPPING_AMBIGUOUS`',
      '`CROSS_TENANT_REFERENCE`',
      '`INTENT_ACTUAL_CARE_COLLAPSE`',
      '`LATENCY_BUDGET_EXCEEDED`',
      'patient or practitioner names',
      'diagnoses, clinical narratives, prescriptions, or result content',
      'invoice, payment, deposit, or money amounts',
      'never include provider result payloads',
    ]) expect(combined).toContain(text);
  });

  it('keeps readiness fail-closed and all retirement or production actions blocked', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      'all 616 current eligible reader pairs have exactly one provider',
      'all five provider families have modules and disabled-default feature flags',
      'The checker must return blocked, not ready, when evidence is absent',
      '`localReady=true` only for local selected-adapter readiness',
      '`productionReady=false`',
      'production observation absent',
      'owner authorisation absent',
      'legacy retirement blocked',
      'Production mutation authorised:** no',
      'Push or CDB-to-main integration authorised:** no',
    ]) expect(combined).toContain(text);
  });
});

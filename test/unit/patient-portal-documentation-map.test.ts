import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const readDoc = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('patient portal documentation map', () => {
  it('documents the canonical backend/frontend auth and hospital context contracts', () => {
    const map = readDoc('docs/PATIENT_PORTAL_SYSTEM_MAP.md');

    expect(map).toContain('/api/patient-auth/login');
    expect(map).toContain('/api/patient-auth/register');
    expect(map).toContain('/api/patient-auth/me');
    expect(map).toContain('PatientLoginPage.tsx');
    expect(map).toContain('PATIENT_SELECTED_HOSPITAL_STORAGE_KEY');
    expect(map).toContain('X-Tenant-ID');
    expect(map).toContain('verified hospital');
    expect(map).toContain('PatientHospitalServicesTab');
    expect(map).toContain('ConnectedCareTab');
  });

  it('documents the patient-facing clinical and document safety rules', () => {
    const map = readDoc('docs/PATIENT_PORTAL_SYSTEM_MAP.md');

    expect(map).toContain('final');
    expect(map).toContain('voided');
    expect(map).toContain('verified');
    expect(map).toContain('released');
    expect(map).toContain('unverified');
    expect(map).toContain('patient_upload');
    expect(map).toContain('hospital_record');
    expect(map).toContain('download_url');
    expect(map).toContain('Do not expose raw `file_key`');
  });

  it('documents the current implementation priorities and validation workflow', () => {
    const plan = readDoc('docs/PATIENT_PORTAL_IMPLEMENTATION_PLAN.md');

    expect(plan).toContain('Enterprise-grade working principles');
    expect(plan).toContain('Preflight validation before mutation');
    expect(plan).toContain('Consistent patient-visible dates');
    expect(plan).toContain('P1-A — Care overview alignment');
    expect(plan).toContain('P1-B — Appointments MVP');
    expect(plan).toContain('P1-C — Prescriptions MVP');
    expect(plan).toContain('P1-D — Lab results MVP');
    expect(plan).toContain('P1-D is complete for the current patient portal scope');
    expect(plan).toContain('Implementation workflow');
    expect(plan).toContain('Validation matrix');
    expect(plan).toContain('Do-not-break list');
    expect(plan).toContain('docs/PATIENT_PORTAL_WORKLOG.md');
    expect(plan).toContain('pnpm --filter ozzyl-lifestyle exec tsc --noEmit --pretty false');
  });

  it('keeps the worklog linked to the map and plan process', () => {
    const worklog = readDoc('docs/PATIENT_PORTAL_WORKLOG.md');

    expect(worklog).toContain('P0');
    expect(worklog).toContain('P1');
    expect(worklog).toContain('Home: global dashboard summary');
    expect(worklog).toContain('Known blocker');
  });
});

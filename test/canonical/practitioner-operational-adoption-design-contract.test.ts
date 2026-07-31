import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const files = {
  audit: 'docs/database/audits/2026-07-26-practitioner-operational-adoption-audit.md',
  plan: 'docs/superpowers/plans/2026-07-26-cdb-113c-practitioner-operational-adoption.md',
};

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('CDB-113C practitioner operational adoption design contract', () => {
  it('keeps substantial audit and serial execution documents', () => {
    expect(fs.existsSync(path.join(root, files.audit))).toBe(true);
    expect(fs.existsSync(path.join(root, files.plan))).toBe(true);
    if (!fs.existsSync(path.join(root, files.audit)) || !fs.existsSync(path.join(root, files.plan))) return;
    expect(read(files.audit).length).toBeGreaterThan(7_000);
    expect(read(files.plan).length).toBeGreaterThan(7_000);
  });

  it('records exact practitioner writer/reader evidence and role separation', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      '`doctors`: 4 writers and 72 readers',
      '`doctor_auth`: 1 writer and 1 reader',
      '`external_referring_doctors`: 1 writer and 2 readers',
      '`users`: 9 writers and 66 readers',
      'Authentication user is not practitioner identity.',
      'Employee is not practitioner identity.',
      'External referrer is an external practitioner role, not a copied internal doctor.',
      'Name-only practitioner matching is prohibited.',
    ]) expect(combined).toContain(text);
  });

  it('defines operational commands and atomic compatibility boundaries', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      'create internal practitioner',
      'create external practitioner',
      'Update or retire practitioner',
      'link or unlink user',
      'link or unlink employee',
      'add, verify, reject, or retire identifier',
      'assign specialty or department',
      'authoritativeStatements',
      'idempotency',
      'expected version',
      'source mapping',
      'PHI-minimised outbox',
    ]) expect(combined).toContain(text);
  });

  it('defines legacy, shadow, and canonical provider behavior without name comparison', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      'legacy mode',
      'shadow mode',
      'canonical mode',
      'practitioner public ID is identity',
      'legacy ID is compatibility metadata only',
      'global/search resolver',
      'appointment practitioner validation',
      'public/marketplace list adapter',
      'encounter participant resolver',
      'feature flag remains disabled',
    ]) expect(combined).toContain(text);
  });

  it('requires reconciliation, additive safety, and exact continuation evidence', () => {
    const combined = `${read(files.audit)}\n${read(files.plan)}`;
    for (const text of [
      'doctor/source mapping cardinality',
      'external referrer mapping',
      'registration identifier uniqueness',
      'user/staff link uniqueness',
      'active provider parity',
      'no name-only mapping',
      'additive migration',
      'Production mutation is not authorised.',
      'Local-sync expansion remains paused.',
      'Destructive legacy retirement is not authorised.',
      'CDB-113D-APPOINTMENT-AUTHORITY',
    ]) expect(combined).toContain(text);
  });
});

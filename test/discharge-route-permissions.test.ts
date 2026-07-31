import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('discharge route permissions', () => {
  const source = readFileSync('src/routes/tenant/discharge.ts', 'utf8');

  it('allows reception to read and print discharge summaries', () => {
    expect(source).toContain("discharge.get('/templates/list', requireRole('hospital_admin', 'doctor', 'md', 'nurse', 'reception')");
    expect(source).toContain("discharge.get('/:admissionId', requireRole('hospital_admin', 'doctor', 'md', 'nurse', 'reception')");
    expect(source).toContain("discharge.get('/:admissionId/slip', requireRole('hospital_admin', 'doctor', 'md', 'nurse', 'reception')");
  });

  it('keeps discharge summary writes limited to clinical/admin roles', () => {
    expect(source).toContain("discharge.put('/:admissionId', requireRole('hospital_admin', 'doctor', 'md')");
    expect(source).not.toContain("discharge.put('/:admissionId', requireRole('hospital_admin', 'doctor', 'md', 'reception')");
  });
});

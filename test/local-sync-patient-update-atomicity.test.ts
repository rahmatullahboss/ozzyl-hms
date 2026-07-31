import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const patientSource = readFileSync('src/routes/tenant/patients.ts', 'utf8');
const updateStart = patientSource.indexOf("patientRoutes.put('/:id'");
const updateEnd = patientSource.indexOf("patientRoutes.get('/duplicates'", updateStart);
const updateRouteSource = patientSource.slice(updateStart, updateEnd);

describe('patient update local-sync atomicity', () => {
  it('writes the patient update and local outbox event in one D1 batch', () => {
    expect(updateStart).toBeGreaterThanOrEqual(0);
    expect(updateEnd).toBeGreaterThan(updateStart);
    expect(updateRouteSource).toContain('buildLocalSyncOutboxStatement');
    expect(updateRouteSource).toContain('const patientUpdateStatement = c.env.DB.prepare');
    expect(updateRouteSource).toContain('await c.env.DB.batch(updateStatements)');
    expect(updateRouteSource).not.toContain('await recordLocalSyncOutboxEvent(c.env');
  });

  it('includes father/guardian and address values in the synchronized update payload', () => {
    expect(updateRouteSource).toContain('fatherHusband: updatedPatient.fatherHusband');
    expect(updateRouteSource).toContain('address: updatedPatient.address');
  });
});

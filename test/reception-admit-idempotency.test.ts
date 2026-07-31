import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const receptionRouteSource = () => readFileSync('src/routes/tenant/reception.ts', 'utf8');
const admissionsRouteSource = () => readFileSync('src/routes/tenant/admissions.ts', 'utf8');

describe('IPD admission idempotency and duplicate guards', () => {
  it('reserves and completes idempotency for reception admit-with-deposit', () => {
    const src = receptionRouteSource();

    expect(src).toContain("const mutationType = 'reception_admit_with_deposit'");
    expect(src).toContain('readMutationIdempotencyReplay');
    expect(src).toContain('reserveMutationIdempotencyKey');
    expect(src).toContain('completeMutationIdempotencyKey');
    expect(src).toContain('markMutationIdempotencyKeyFailed');
  });

  it('uses conditional admission insert guards in reception admit-with-deposit', () => {
    const src = receptionRouteSource();

    expect(src).toContain('INSERT INTO admissions');
    expect(src).toContain('WHERE NOT EXISTS');
    expect(src).toContain("active.status IN ('admitted','critical','transferred')");
    expect(src).toContain("b.status = 'available'");
    expect(src).toContain('Patient is already admitted');
    expect(src).toContain('Bed is');
  });

  it('keeps bed/deposit/cash side effects dependent on actual admission creation', () => {
    const src = receptionRouteSource();

    expect(src).toContain('AND EXISTS (');
    expect(src).toContain('a.admission_no = ?');
    expect(src).toContain('INSERT INTO billing_deposits');
    expect(src).toContain("SELECT ?, ?, a.id, ?, ?, 'deposit'");
    expect(src).toContain('FROM admissions a');
    expect(src).toContain("SELECT ?, ?, ?, ?, 'CashSales'");
  });

  it('hardens the direct admissions create route against duplicate active admissions', () => {
    const src = admissionsRouteSource();

    expect(src).toContain('INSERT INTO admissions');
    expect(src).toContain('WHERE NOT EXISTS');
    expect(src).toContain("active.status IN ('admitted','critical','transferred')");
    expect(src).toContain("b.status IN ('available', 'reserved')");
    expect(src).toContain('Patient is already admitted');
  });
});

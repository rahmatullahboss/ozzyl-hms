import { describe, expect, it } from 'vitest';
import {
  applyForeignKeyWaivers,
  type ForeignKeyWaiver,
} from '../../scripts/canonical/apply-fk-waivers';

const FIXTURE_SCHEMA = `
CREATE TABLE doctor_commission_accruals_old_0391 (
  id INTEGER PRIMARY KEY,
  doctor_id INTEGER REFERENCES doctors(id),
  visit_id INTEGER REFERENCES visits(id),
  bill_id INTEGER REFERENCES bills(id)
);
CREATE INDEX idx_dc_bill ON doctor_commission_accruals_old_0391(bill_id);
CREATE TABLE billing_deposits (
  id INTEGER PRIMARY KEY,
  patient_id INTEGER,
  reference_bill_id INTEGER,
  FOREIGN KEY (patient_id) REFERENCES patients_old(id),
  FOREIGN KEY (reference_bill_id) REFERENCES bills(id)
);
CREATE TABLE income (
  id INTEGER PRIMARY KEY,
  bill_id INTEGER,
  created_by INTEGER,
  FOREIGN KEY (bill_id) REFERENCES bills(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
`;

const WAIVERS: ForeignKeyWaiver[] = [
  {
    table: 'doctor_commission_accruals_old_0391',
    column: 'visit_id',
    parentTable: 'visits',
    reason: '15 legacy orphan rows',
  },
  {
    table: 'doctor_commission_accruals_old_0391',
    column: 'bill_id',
    parentTable: 'bills',
    reason: '26 legacy orphan rows',
  },
  {
    table: 'billing_deposits',
    column: 'reference_bill_id',
    parentTable: 'bills',
    reason: '4 legacy orphan rows',
  },
  {
    table: 'income',
    column: 'bill_id',
    parentTable: 'bills',
    reason: '4 legacy orphan rows',
  },
];

describe('CDB-011 FK waiver schema transformation', () => {
  it('removes only the four approved legacy constraints and preserves unrelated constraints', () => {
    const result = applyForeignKeyWaivers(FIXTURE_SCHEMA, WAIVERS);

    expect(result.schemaSql).toContain(
      'doctor_id INTEGER REFERENCES doctors(id)',
    );
    expect(result.schemaSql).toContain(
      'FOREIGN KEY (patient_id) REFERENCES patients_old(id)',
    );
    expect(result.schemaSql).toContain(
      'FOREIGN KEY (created_by) REFERENCES users(id)',
    );
    expect(result.schemaSql).not.toContain(
      'visit_id INTEGER REFERENCES visits(id)',
    );
    expect(result.schemaSql).not.toContain(
      'bill_id INTEGER REFERENCES bills(id)',
    );
    expect(result.schemaSql).not.toContain(
      'FOREIGN KEY (reference_bill_id) REFERENCES bills(id)',
    );
    expect(result.appliedWaivers).toEqual(WAIVERS);
    expect(result.schemaSql).toContain(
      'CREATE INDEX idx_dc_bill ON doctor_commission_accruals_old_0391(bill_id)',
    );
  });

  it('fails closed when an approved waiver cannot be matched exactly once', () => {
    expect(() =>
      applyForeignKeyWaivers(FIXTURE_SCHEMA, [
        {
          table: 'income',
          column: 'missing_column',
          parentTable: 'bills',
          reason: 'invalid fixture waiver',
        },
      ]),
    ).toThrow(/matched 0 constraints/i);
  });
});

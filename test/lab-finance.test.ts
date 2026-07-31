import { describe, expect, it } from 'vitest';
import { accrueBillCommissions, accrueLabOrderDoctorCommissions, accrueLabVerificationCommissions, calculateCommissionAmount, calculateGrossProfit, capConsultationCommissionAtCollectedAmount, previewDoctorCommissionForItems } from '../src/lib/lab-finance.ts';

describe('lab finance calculations', () => {
  it('calculates percentage doctor commission from basis points', () => {
    expect(calculateCommissionAmount({
      grossAmount: 10_000,
      rateType: 'percent',
      rateValue: 1_250,
    })).toBe(1_250);
  });

  it('keeps percentage commissions at currency precision instead of flooring each line', () => {
    expect(calculateCommissionAmount({
      grossAmount: 802,
      rateType: 'percent',
      rateValue: 2_500,
    })).toBe(200.5);
  });

  it('reconciles a 25% rule to the exact aggregate collection total', () => {
    const testLines = [2100, 800, 4000, 400, 1300, 3000, 1200, 1700];
    const commission = testLines.reduce((sum, grossAmount) => sum + calculateCommissionAmount({
      grossAmount,
      rateType: 'percent',
      rateValue: 2_500,
    }), 0);

    expect(testLines.reduce((sum, value) => sum + value, 0)).toBe(14_500);
    expect(commission).toBe(3_625);
  });

  it('calculates percentage commission after performer reserve deduction', () => {
    expect(calculateCommissionAmount({
      grossAmount: 3_700,
      rateType: 'percent',
      rateValue: 2_500,
    })).toBe(925);
  });

  it('calculates flat doctor commission amounts', () => {
    expect(calculateCommissionAmount({
      grossAmount: 10_000,
      rateType: 'flat',
      rateValue: 750,
    })).toBe(750);
  });

  it('caps consultation commission at collected net amount', () => {
    expect(capConsultationCommissionAtCollectedAmount(700, 1000)).toBe(700);
    expect(capConsultationCommissionAtCollectedAmount(0, 1000)).toBe(0);
    expect(capConsultationCommissionAtCollectedAmount(700, 300)).toBe(300);
  });

  it('calculates test profit after consumables and doctor commission', () => {
    expect(calculateGrossProfit({
      revenue: 50_000,
      consumableCost: 8_000,
      doctorCommission: 5_000,
    })).toEqual({
      grossProfit: 37_000,
      marginPercent: 74,
    });
  });
});



function createFinanceDb() {
  const rules: any[] = [];
  const accruals: any[] = [];
  const postingEvents: any[] = [];
  const labTestCommissionEligibility = new Map<number, number>();
  let nextAccrualId = 1;
  return {
    rules,
    accruals,
    postingEvents,
    labTestCommissionEligibility,
    visitDoctorId: 3,
    prepare(sql: string) {
      return {
        bind(...params: any[]) {
          return {
            async first() {
              if (sql.includes('FROM visits')) return { doctor_id: 3 };
              if (sql.includes('FROM doctors')) return { id: 7 };
              if (sql.includes('FROM diagnostic_performer_reserves')) return null;
              if (sql.includes('FROM doctor_commission_rules')) {
                const [, doctorId, serviceType, incentiveType, labTestId, category] = params;
                return rules
                  .filter((rule) => rule.doctor_id === doctorId && rule.service_type === serviceType && rule.incentive_type === incentiveType && rule.is_active !== 0)
                  .filter((rule) => rule.lab_test_id === labTestId || rule.lab_test_id == null)
                  .filter((rule) => rule.category === category || rule.category == null || rule.category === '')
                  .sort((a, b) => b.id - a.id)[0] ?? null;
              }
              return null;
            },
            async all() {
              if (sql.includes('FROM doctor_commission_rules')) {
                const [, doctorId] = params;
                return {
                  results: rules.filter((rule) => rule.doctor_id === doctorId && rule.is_active !== 0),
                };
              }
              if (sql.includes('FROM lab_test_catalog') && sql.includes('is_commissionable')) {
                return {
                  results: params.slice(1)
                    .map((id) => Number(id))
                    .filter((id) => labTestCommissionEligibility.has(id))
                    .map((id) => ({ id, is_commissionable: labTestCommissionEligibility.get(id) })),
                };
              }
              return { results: [] };
            },
            async run() {
              if (sql.includes('INSERT OR IGNORE INTO doctor_commission_accruals')) {
                if (sql.includes('lab_order_id')) {
                  const row = {
                    id: nextAccrualId++,
                    tenant_id: params[0],
                    doctor_id: params[1],
                    patient_id: params[2],
                    visit_id: params[3],
                    bill_id: params[4],
                    lab_test_id: params[7],
                    source_type: 'lab_test',
                    incentive_type: sql.includes("'performer'") ? 'performer' : params[8],
                    commission_rule_id: params[10],
                    commission_rule_version_snapshot: params[11],
                    commission_reason_code: params[12],
                    commission_amount: params[15],
                  };
                  accruals.push(row);
                  return { meta: { changes: 1, last_row_id: row.id } };
                }
                const performer = sql.includes("'lab_test', 'performer'");
                const consultation = sql.includes("'consultation_fee', 'performer'");
                const hasProtectedSnapshot = sql.includes('waiver_policy_snapshot');
                const snapshotStart = performer ? 16 : consultation ? 15 : 19;
                const row = {
                  id: nextAccrualId++,
                  tenant_id: params[0],
                  doctor_id: params[1],
                  patient_id: params[2],
                  visit_id: params[3],
                  bill_id: params[4],
                  lab_test_id: consultation ? null : params[5],
                  canonical_source_key: consultation ? params[5] : params[6],
                  source_type: performer ? 'lab_test' : consultation ? 'consultation_fee' : params[7],
                  incentive_type: performer || consultation ? 'performer' : params[8],
                  gross_amount: performer ? params[7] : consultation ? params[6] : params[9],
                  commission_base_amount: performer ? params[8] : consultation ? params[7] : params[10],
                  performer_reserve_amount: performer || consultation ? 0 : params[11],
                  commission_rule_id: performer ? params[9] : consultation ? params[8] : params[12],
                  commission_rule_version_snapshot: performer ? params[10] : consultation ? params[9] : params[13],
                  commission_reason_code: performer ? params[11] : consultation ? params[10] : params[14],
                  commission_amount: performer ? params[14] : consultation ? params[13] : params[17],
                  earned_commission_amount: performer ? params[15] : consultation ? params[14] : params[18],
                  waiver_policy_snapshot: hasProtectedSnapshot ? params[snapshotStart] : 'full_earned',
                  protected_rate_bps_snapshot: hasProtectedSnapshot ? params[snapshotStart + 1] : 0,
                  protected_flat_amount_snapshot: hasProtectedSnapshot ? params[snapshotStart + 2] : 0,
                  protected_commission_amount: hasProtectedSnapshot ? params[snapshotStart + 3] : 0,
                  maximum_waiver_amount: hasProtectedSnapshot ? params[snapshotStart + 4] : 0,
                  requested_waiver_amount: hasProtectedSnapshot ? params[snapshotStart + 5] : 0,
                  hospital_funded_overflow_amount: hasProtectedSnapshot ? params[snapshotStart + 6] : 0,
                  doctor_waiver_amount: hasProtectedSnapshot
                    ? params[snapshotStart + 7]
                    : performer ? params[16] : consultation ? params[15] : params[19],
                  payable_commission_amount: hasProtectedSnapshot
                    ? params[snapshotStart + 8]
                    : performer ? params[17] : consultation ? params[16] : params[20],
                  balance_amount: hasProtectedSnapshot
                    ? params[snapshotStart + 9]
                    : performer ? params[18] : consultation ? params[17] : params[21],
                  notes: performer ? params[hasProtectedSnapshot ? 28 : 21] : consultation ? null : params[hasProtectedSnapshot ? 31 : 24],
                };
                const duplicate = accruals.some((existing) => existing.tenant_id === row.tenant_id && existing.canonical_source_key === row.canonical_source_key);
                if (!duplicate) accruals.push(row);
                return { meta: { changes: duplicate ? 0 : 1, last_row_id: row.id } };
              }
              if (sql.includes('INSERT OR IGNORE INTO accounting_posting_events')) {
                postingEvents.push(JSON.parse(String(params[6] ?? '{}')));
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  } as any;
}

describe('doctor waiver commission preview', () => {
  it('preserves lab-specific, category-specific, and generic rule priority when rules are batch-loaded', async () => {
    const db = createFinanceDb();
    db.rules.push(
      { id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', lab_test_id: null, category: null, rate_type: 'percent', rate_value: 1000, is_active: 1 },
      { id: 2, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', lab_test_id: null, category: 'test', rate_type: 'percent', rate_value: 2000, is_active: 1 },
      { id: 3, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', lab_test_id: 42, category: null, rate_type: 'percent', rate_value: 3000, is_active: 1 },
    );

    const preview = await previewDoctorCommissionForItems(db, {
      tenantId: 't1',
      doctorId: 3,
      billDate: '2026-07-27',
      items: [
        { itemCategory: 'test', lineTotal: 1000, grossLineTotal: 1000, labTestId: 42 },
        { itemCategory: 'test', lineTotal: 1000, grossLineTotal: 1000, labTestId: 43 },
      ],
    });

    expect(preview.lines.map((line) => line.commissionAmount)).toEqual([300, 200]);
    expect(preview.eligibleCommissionAmount).toBe(500);
  });

  it('uses discounted collection rather than pre-discount gross for diagnostic commission preview', async () => {
    const db = createFinanceDb();
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', category: null, rate_type: 'percent', rate_value: 2500, is_active: 1 });

    const preview = await previewDoctorCommissionForItems(db, {
      tenantId: 't1',
      doctorId: 3,
      billDate: '2026-07-19',
      items: [
        { itemCategory: 'test', description: 'CBC', lineTotal: 250, grossLineTotal: 400, referenceId: 11 },
        { itemCategory: 'test', description: 'ECG', lineTotal: 250, grossLineTotal: 400, referenceId: 12 },
      ],
    });

    expect(preview.eligibleCommissionAmount).toBe(125);
    expect(preview.lines.map((line) => line.commissionAmount)).toEqual([62.5, 62.5]);
  });

  it('deducts performer reserve from discounted collection in diagnostic commission preview', async () => {
    const db = createFinanceDb();
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', category: null, rate_type: 'percent', rate_value: 2500, is_active: 1 });

    const preview = await previewDoctorCommissionForItems(db, {
      tenantId: 't1',
      doctorId: 3,
      billDate: '2026-07-20',
      items: [{
        itemCategory: 'usg',
        description: 'USG',
        lineTotal: 900,
        grossLineTotal: 1000,
        performerReserveAmount: 200,
        referenceId: 44,
      }],
    });

    expect(preview.lines).toMatchObject([{
      grossAmount: 700,
      commissionAmount: 175,
    }]);
    expect(preview.eligibleCommissionAmount).toBe(175);
  });

  it('excludes non-commissionable lab tests from preview including referral fallback', async () => {
    const db = createFinanceDb();
    db.labTestCommissionEligibility.set(44, 0);
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', lab_test_id: 44, category: null, rate_type: 'flat', rate_value: 100, is_active: 1 });
    db.rules.push({ id: 2, doctor_id: 3, service_type: 'referral', incentive_type: 'referrer', lab_test_id: null, category: null, rate_type: 'flat', rate_value: 50, is_active: 1 });

    const preview = await previewDoctorCommissionForItems(db, {
      tenantId: 't1',
      doctorId: 3,
      billDate: '2026-07-21',
      items: [{ itemCategory: 'test', description: 'Cross Matching', lineTotal: 900, labTestId: 44 }],
    });

    expect(preview).toEqual({
      doctorId: 3,
      eligibleCommissionAmount: 0,
      protectedCommissionAmount: 0,
      maximumDoctorWaiverAmount: 0,
      lines: [],
    });
  });
});

describe('bill performer doctor commission accrual', () => {
  it('accrues diagnostic performer commission from bill line performer doctor', async () => {
    const db = createFinanceDb();
    db.rules.push({ id: 1, doctor_id: 7, service_type: 'lab_test', incentive_type: 'performer', category: null, rate_type: 'flat', rate_value: 200, is_active: 1 });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 55, referringDoctorId: null, billDate: '2026-07-01',
      items: [{ itemCategory: 'usg', description: 'USG Whole Abdomen', lineTotal: 1200, referenceId: 44, performerDoctorId: 7 }],
    });

    expect(count).toBe(1);
    expect(db.accruals).toMatchObject([{ doctor_id: 7, source_type: 'lab_test', incentive_type: 'performer', commission_amount: 200 }]);
  });

  it('stores the protected-floor snapshot for a performer doctor waiver', async () => {
    const db = createFinanceDb();
    db.rules.push({
      id: 1,
      doctor_id: 7,
      service_type: 'lab_test',
      incentive_type: 'performer',
      category: null,
      rate_type: 'percent',
      rate_value: 2500,
      waiver_policy: 'protected_floor',
      protected_rate_bps: 500,
      protected_flat_amount: 0,
      is_active: 1,
    });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 550, referringDoctorId: null, billDate: '2026-07-26',
      doctorCommissionWaivers: [{ doctorId: 7, amount: 500 }],
      items: [{ itemCategory: 'usg', description: 'USG Whole Abdomen', lineTotal: 1000, referenceId: 44, performerDoctorId: 7 }],
    });

    expect(count).toBe(1);
    expect(db.accruals[0]).toMatchObject({
      doctor_id: 7,
      waiver_policy_snapshot: 'protected_floor',
      protected_rate_bps_snapshot: 500,
      protected_commission_amount: 50,
      maximum_waiver_amount: 200,
      doctor_waiver_amount: 200,
      payable_commission_amount: 50,
    });
  });

  it('does not enqueue a zero-value accounting event for a fully waived performer commission', async () => {
    const db = createFinanceDb();
    db.rules.push({
      id: 1,
      doctor_id: 7,
      service_type: 'lab_test',
      incentive_type: 'performer',
      category: null,
      rate_type: 'percent',
      rate_value: 2500,
      waiver_policy: 'full_earned',
      protected_rate_bps: 0,
      protected_flat_amount: 0,
      is_active: 1,
    });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 551, referringDoctorId: null, billDate: '2026-07-26',
      doctorCommissionWaivers: [{ doctorId: 7, amount: 250 }],
      items: [{ itemCategory: 'usg', description: 'USG Whole Abdomen', lineTotal: 1000, referenceId: 44, performerDoctorId: 7 }],
    });

    expect(count).toBe(1);
    expect(db.accruals[0]).toMatchObject({
      earned_commission_amount: 250,
      doctor_waiver_amount: 250,
      payable_commission_amount: 0,
    });
    expect(db.postingEvents).toHaveLength(0);
  });

  it('does not enqueue a zero-value accounting event for a fully waived consultation commission', async () => {
    const db = createFinanceDb();
    db.rules.push({
      id: 2,
      doctor_id: 3,
      service_type: 'consultation_fee',
      incentive_type: 'performer',
      category: null,
      rate_type: 'flat',
      rate_value: 100,
      waiver_policy: 'full_earned',
      protected_rate_bps: 0,
      protected_flat_amount: 0,
      is_active: 1,
    });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: 12, billId: 552, referringDoctorId: null, billDate: '2026-07-26',
      doctorCommissionWaivers: [{ doctorId: 3, amount: 100 }],
      items: [{ itemCategory: 'doctor_visit', description: 'Consultation', lineTotal: 500, grossLineTotal: 500, referenceId: 3 }],
    });

    expect(count).toBe(1);
    expect(db.accruals[0]).toMatchObject({
      earned_commission_amount: 100,
      doctor_waiver_amount: 100,
      payable_commission_amount: 0,
    });
    expect(db.postingEvents).toHaveLength(0);
  });

  it('does not accrue performer commission when no performer doctor is selected', async () => {
    const db = createFinanceDb();
    db.rules.push({ id: 1, doctor_id: 7, service_type: 'lab_test', incentive_type: 'performer', category: null, rate_type: 'flat', rate_value: 200, is_active: 1 });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 56, referringDoctorId: null, billDate: '2026-07-01',
      items: [{ itemCategory: 'usg', description: 'USG Whole Abdomen', lineTotal: 1200, referenceId: 44 }],
    });

    expect(count).toBe(0);
    expect(db.accruals).toHaveLength(0);
  });

  it('accrues separate prescriber and performer commissions when both doctors are configured', async () => {
    const db = createFinanceDb();
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', category: null, rate_type: 'flat', rate_value: 100, is_active: 1 });
    db.rules.push({ id: 2, doctor_id: 7, service_type: 'lab_test', incentive_type: 'performer', category: null, rate_type: 'flat', rate_value: 200, is_active: 1 });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 57, referringDoctorId: 3, billDate: '2026-07-01',
      items: [{ itemCategory: 'usg', description: 'USG Whole Abdomen', lineTotal: 1200, referenceId: 44, performerDoctorId: 7 }],
    });

    expect(count).toBe(2);
    expect(db.accruals.map((row: any) => [row.doctor_id, row.incentive_type, row.commission_amount])).toEqual([[3, 'prescriber', 100], [7, 'performer', 200]]);
  });

  it('uses the reserve-reduced commission base and suppresses bill-time performer accrual', async () => {
    const db = createFinanceDb();
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', category: null, rate_type: 'percent', rate_value: 2000, is_active: 1 });
    db.rules.push({ id: 2, doctor_id: 7, service_type: 'lab_test', incentive_type: 'performer', category: null, rate_type: 'flat', rate_value: 200, is_active: 1 });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 58, referringDoctorId: 3, billDate: '2026-07-01',
      items: [{
        itemCategory: 'usg',
        description: 'USG Whole Abdomen',
        lineTotal: 1000,
        referenceId: 44,
        performerDoctorId: 7,
        commissionBaseAmount: 800,
        performerReserveAmount: 200,
        hasPerformerReserve: true,
      }],
    });

    expect(count).toBe(1);
    expect(db.accruals).toMatchObject([{
      doctor_id: 3,
      incentive_type: 'prescriber',
      gross_amount: 1000,
      commission_base_amount: 800,
      performer_reserve_amount: 200,
      commission_amount: 160,
    }]);
  });

  it('uses discounted net base after reserve', async () => {
    const db = createFinanceDb();
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', category: null, rate_type: 'percent', rate_value: 2000, is_active: 1 });

    await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 59, referringDoctorId: 3, billDate: '2026-07-01',
      items: [{
        itemCategory: 'usg', description: 'USG', lineTotal: 900, grossLineTotal: 1000, referenceId: 44,
        commissionBaseAmount: 700, performerReserveAmount: 200, hasPerformerReserve: true,
      }],
    });

    expect(db.accruals[0].commission_amount).toBe(140);
  });

  it('reconciles the live BDT 1,100 gross hospital-discount bill to BDT 200 commission', async () => {
    const db = createFinanceDb();
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', category: null, rate_type: 'percent', rate_value: 2500, is_active: 1 });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 6894, referringDoctorId: 3, billDate: '2026-07-22',
      items: [
        {
          itemCategory: 'test', description: 'Ultrasonography Of Lower Abdomen', lineTotal: 636, grossLineTotal: 700, referenceId: 343,
          commissionBaseAmount: 436, performerReserveAmount: 200, hasPerformerReserve: true,
        },
        { itemCategory: 'test', description: 'Urine RE/ME', lineTotal: 182, grossLineTotal: 200, referenceId: 236 },
        { itemCategory: 'test', description: 'Pregnancy Test', lineTotal: 182, grossLineTotal: 200, referenceId: 238 },
      ],
    });

    expect(count).toBe(3);
    expect(db.accruals.map((row: any) => row.commission_base_amount)).toEqual([436, 182, 182]);
    expect(db.accruals.reduce((sum: number, row: any) => sum + row.payable_commission_amount, 0)).toBe(200);
  });

  it('keeps hospital-funded discounts out of the prescriber commission base', async () => {
    const db = createFinanceDb();
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', category: null, rate_type: 'percent', rate_value: 2500, is_active: 1 });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 60, referringDoctorId: 3, billDate: '2026-07-01',
      items: [{ itemCategory: 'test', description: 'CBC & ECG', lineTotal: 500, grossLineTotal: 800, referenceId: 44 }],
    });

    expect(count).toBe(1);
    expect(db.accruals[0]).toMatchObject({
      gross_amount: 800,
      commission_base_amount: 500,
      earned_commission_amount: 125,
      doctor_waiver_amount: 0,
      payable_commission_amount: 125,
      commission_amount: 125,
    });
  });

  it('calculates doctor-waiver commission from the discounted diagnostic amount', async () => {
    const db = createFinanceDb();
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', category: null, rate_type: 'percent', rate_value: 2500, is_active: 1 });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 60, referringDoctorId: 3, billDate: '2026-07-01',
      doctorCommissionWaivers: [{ doctorId: 3, amount: 200 }],
      items: [{
        itemCategory: 'test', description: 'CBC', lineTotal: 800, grossLineTotal: 1000, referenceId: 44,
      }],
    });

    expect(count).toBe(1);
    expect(db.accruals[0]).toMatchObject({
      commission_base_amount: 800,
      earned_commission_amount: 200,
      doctor_waiver_amount: 200,
      payable_commission_amount: 0,
      commission_amount: 0,
      balance_amount: 0,
    });
  });

  it('keeps doctor waiver separate from the discounted reserve-reduced commission base', async () => {
    const db = createFinanceDb();
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', category: null, rate_type: 'percent', rate_value: 2500, is_active: 1 });

    await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 61, referringDoctorId: 3, billDate: '2026-07-01',
      doctorCommissionWaivers: [{ doctorId: 3, amount: 100 }],
      items: [{
        itemCategory: 'usg', description: 'USG', lineTotal: 800, grossLineTotal: 1000, referenceId: 44,
        commissionBaseAmount: 600, performerReserveAmount: 200, hasPerformerReserve: true,
      }],
    });

    expect(db.accruals[0]).toMatchObject({
      commission_base_amount: 600,
      earned_commission_amount: 150,
      doctor_waiver_amount: 100,
      payable_commission_amount: 50,
      commission_amount: 50,
    });
  });

  it('protects the configured commission floor from an excessive doctor waiver', async () => {
    const db = createFinanceDb();
    db.rules.push({
      id: 1,
      doctor_id: 3,
      service_type: 'lab_test',
      incentive_type: 'prescriber',
      category: null,
      rate_type: 'percent',
      rate_value: 2500,
      waiver_policy: 'protected_floor',
      protected_rate_bps: 500,
      protected_flat_amount: 0,
      is_active: 1,
    });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 610, referringDoctorId: 3, billDate: '2026-07-26',
      doctorCommissionWaivers: [{ doctorId: 3, amount: 500 }],
      items: [{ itemCategory: 'test', description: 'CBC', lineTotal: 1000, grossLineTotal: 1000, referenceId: 44 }],
    });

    expect(count).toBe(1);
    expect(db.accruals[0]).toMatchObject({
      commission_base_amount: 1000,
      earned_commission_amount: 250,
      waiver_policy_snapshot: 'protected_floor',
      protected_rate_bps_snapshot: 500,
      protected_commission_amount: 50,
      maximum_waiver_amount: 200,
      requested_waiver_amount: 200,
      hospital_funded_overflow_amount: 0,
      doctor_waiver_amount: 200,
      payable_commission_amount: 50,
      commission_amount: 50,
    });
  });

  it('reconciles protected-floor rounding across multiple percentage commission lines', async () => {
    const db = createFinanceDb();
    db.rules.push({
      id: 1,
      doctor_id: 3,
      service_type: 'lab_test',
      incentive_type: 'prescriber',
      category: null,
      rate_type: 'percent',
      rate_value: 2500,
      waiver_policy: 'protected_floor',
      protected_rate_bps: 500,
      protected_flat_amount: 0,
      is_active: 1,
    });

    const items = [
      { itemCategory: 'test', description: 'BloodSugar (RBS,PPBS)', lineTotal: 163.64, grossLineTotal: 200, referenceId: 242 },
      { itemCategory: 'test', description: 'S. Amaylase', lineTotal: 981.82, grossLineTotal: 1200, referenceId: 261 },
      {
        itemCategory: 'test',
        description: 'Ultrasonography Of Whole Abdomen',
        lineTotal: 654.54,
        grossLineTotal: 800,
        referenceId: 342,
        commissionBaseAmount: 454.54,
        performerReserveAmount: 200,
        hasPerformerReserve: true,
      },
    ];

    const preview = await previewDoctorCommissionForItems(db, {
      tenantId: 't1',
      doctorId: 3,
      billDate: '2026-07-27',
      items,
    });

    expect(preview.eligibleCommissionAmount).toBe(400);
    expect(preview.protectedCommissionAmount).toBe(80);
    expect(preview.maximumDoctorWaiverAmount).toBe(320);

    const count = await accrueBillCommissions(db, {
      tenantId: 't1',
      userId: 99,
      patientId: 10,
      visitId: null,
      billId: 7085,
      referringDoctorId: 3,
      billDate: '2026-07-27',
      doctorCommissionWaivers: [{ doctorId: 3, amount: 400 }],
      items,
    });

    expect(count).toBe(3);
    expect(db.accruals.reduce((sum: number, row: any) => sum + row.earned_commission_amount, 0)).toBe(400);
    expect(db.accruals.reduce((sum: number, row: any) => sum + row.protected_commission_amount, 0)).toBe(80);
    expect(db.accruals.reduce((sum: number, row: any) => sum + row.doctor_waiver_amount, 0)).toBe(320);
    expect(db.accruals.reduce((sum: number, row: any) => sum + row.payable_commission_amount, 0)).toBe(80);
  });

  it('persists earned and waived commission even when doctor payable becomes zero', async () => {
    const db = createFinanceDb();
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', category: null, rate_type: 'percent', rate_value: 2000, is_active: 1 });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 62, referringDoctorId: 3, billDate: '2026-07-01',
      doctorCommissionWaivers: [{ doctorId: 3, amount: 200 }],
      items: [{ itemCategory: 'test', description: 'CBC', lineTotal: 800, grossLineTotal: 1000, referenceId: 44 }],
    });

    expect(count).toBe(1);
    expect(db.accruals[0]).toMatchObject({
      commission_base_amount: 800,
      earned_commission_amount: 160,
      doctor_waiver_amount: 160,
      payable_commission_amount: 0,
      commission_amount: 0,
      balance_amount: 0,
      commission_reason_code: 'doctor_waived',
    });
  });

  it('blocks prescriber, referral fallback, and line performer accrual for a non-commissionable test', async () => {
    const db = createFinanceDb();
    db.labTestCommissionEligibility.set(44, 0);
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'referral', incentive_type: 'referrer', lab_test_id: null, category: null, rate_type: 'flat', rate_value: 100, is_active: 1 });
    db.rules.push({ id: 2, doctor_id: 7, service_type: 'lab_test', incentive_type: 'performer', lab_test_id: 44, category: null, rate_type: 'flat', rate_value: 200, is_active: 1 });

    const count = await accrueBillCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 63, referringDoctorId: 3, billDate: '2026-07-21',
      items: [{ itemCategory: 'test', description: 'Cross Matching', lineTotal: 900, referenceId: 44, labTestId: 44, performerDoctorId: 7 }],
    });

    expect(count).toBe(0);
    expect(db.accruals).toHaveLength(0);
  });
});

describe('lab test commission eligibility across accrual stages', () => {
  it('snapshots the matched legacy rule version and explanation on a new accrual', async () => {
    const db = createFinanceDb();
    db.rules.push({
      id: 9,
      rule_version: 3,
      doctor_id: 3,
      service_type: 'lab_test',
      incentive_type: 'prescriber',
      lab_test_id: 44,
      category: null,
      rate_type: 'flat',
      rate_value: 100,
      is_active: 1,
    });

    const count = await accrueLabOrderDoctorCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: 20, billId: 63,
      labOrderId: 70, orderDate: '2026-07-21',
      items: [{ labOrderItemId: 71, labTestId: 44, category: 'Blood Bank', lineTotal: 900 }],
    });

    expect(count).toBe(1);
    expect(db.accruals[0]).toMatchObject({
      commission_rule_id: 9,
      commission_rule_version_snapshot: 3,
      commission_reason_code: 'rule_matched',
    });
  });

  it('blocks order-time prescriber accrual for a non-commissionable lab test', async () => {
    const db = createFinanceDb();
    db.labTestCommissionEligibility.set(44, 0);
    db.rules.push({ id: 1, doctor_id: 3, service_type: 'lab_test', incentive_type: 'prescriber', lab_test_id: 44, category: null, rate_type: 'flat', rate_value: 100, is_active: 1 });

    const count = await accrueLabOrderDoctorCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: 20, billId: null,
      labOrderId: 70, orderDate: '2026-07-21',
      items: [{ labOrderItemId: 71, labTestId: 44, category: 'Blood Bank', lineTotal: 900 }],
    });

    expect(count).toBe(0);
    expect(db.accruals).toHaveLength(0);
  });

  it('blocks verification-time performer accrual for a non-commissionable lab test', async () => {
    const db = createFinanceDb();
    db.labTestCommissionEligibility.set(44, 0);
    db.rules.push({ id: 1, doctor_id: 7, service_type: 'lab_test', incentive_type: 'performer', lab_test_id: 44, category: null, rate_type: 'flat', rate_value: 200, is_active: 1 });

    const count = await accrueLabVerificationCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: 20, billId: 63,
      labOrderId: 70, labOrderItemId: 71, labTestId: 44, category: 'Blood Bank', lineTotal: 900,
      verificationDate: '2026-07-21',
    });

    expect(count).toBe(0);
    expect(db.accruals).toHaveLength(0);
  });
});

describe('lab verification performer reserve guard', () => {
  it('does not create a second performer accrual when a reserve exists', async () => {
    let ruleLookupCount = 0;
    const db = {
      prepare(sql: string) {
        return {
          bind() {
            return {
              async first() {
                if (sql.includes('FROM diagnostic_performer_reserves')) return { id: 701 };
                if (sql.includes('FROM doctors')) return { id: 7 };
                if (sql.includes('FROM doctor_commission_rules')) ruleLookupCount += 1;
                return null;
              },
              async all() {
                if (sql.includes('FROM lab_test_catalog')) return { results: [{ id: 13, is_commissionable: 1 }] };
                return { results: [] };
              },
              async run() { return { meta: { changes: 0 } }; },
            };
          },
        };
      },
    } as any;

    const count = await accrueLabVerificationCommissions(db, {
      tenantId: 't1', userId: 99, patientId: 10, visitId: null, billId: 60,
      labOrderId: 11, labOrderItemId: 12, labTestId: 13, category: 'lab', lineTotal: 1000,
      verificationDate: '2026-07-01',
    });

    expect(count).toBe(0);
    expect(ruleLookupCount).toBe(0);
  });
});

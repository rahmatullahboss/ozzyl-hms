import { describe, expect, it } from 'vitest';
import {
  buildPatientAgeAnalyticsResponse,
  type PatientAgeAggregateInput,
} from '../../src/services/dashboard/patientAgeContract';

const period = {
  startDate: '2026-07-01',
  endDate: '2026-07-28',
  label: '2026-07-01 – 2026-07-28',
};

const rows: PatientAgeAggregateInput[] = [
  {
    bucket: '0_5',
    uniquePatients: 2,
    visits: 3,
    admissions: 1,
    services: 4,
    billCount: 2,
    collection: 1000,
    repeatPatients: 1,
  },
  {
    bucket: '18_30',
    uniquePatients: 3,
    visits: 3,
    admissions: 0,
    services: 5,
    billCount: 3,
    collection: 1500,
    repeatPatients: 0,
  },
];

describe('patient age aggregate contract', () => {
  it('returns all seven buckets in stable order including zero rows', () => {
    const response = buildPatientAgeAnalyticsResponse({ period, rows });
    expect(response.rows.map((row) => row.bucket)).toEqual([
      '0_5',
      '6_17',
      '18_30',
      '31_45',
      '46_60',
      '61_plus',
      'unknown',
    ]);
    expect(response.rows[1]).toMatchObject({
      bucket: '6_17',
      uniquePatients: 0,
      visits: 0,
      admissions: 0,
      services: 0,
      billCount: 0,
      collection: 0,
      averageBill: 0,
      repeatPatients: 0,
      repeatVisitRate: 0,
      patientShare: 0,
    });
  });

  it('makes totals equal bucket sums for additive measures', () => {
    const response = buildPatientAgeAnalyticsResponse({ period, rows });
    expect(response.totals).toMatchObject({
      uniquePatients: 5,
      visits: 6,
      admissions: 1,
      services: 9,
      billCount: 5,
      collection: 2500,
      repeatPatients: 1,
    });
    expect(response.totals.averageBill).toBe(500);
    expect(response.totals.repeatVisitRate).toBe(20);
  });

  it('uses collection divided by unique bills for average bill', () => {
    const response = buildPatientAgeAnalyticsResponse({ period, rows });
    expect(response.metadata.averageBillDenominator).toBe('unique_bills');
    expect(response.rows.find((row) => row.bucket === '0_5')?.averageBill).toBe(500);
    expect(response.rows.find((row) => row.bucket === '18_30')?.averageBill).toBe(500);
  });

  it('uses repeat patients divided by unique patients and remains zero-safe', () => {
    const response = buildPatientAgeAnalyticsResponse({ period, rows });
    expect(response.metadata.repeatVisitRateDenominator).toBe('unique_patients');
    expect(response.metadata.repeatVisitRateNumerator).toBe('patients_with_multiple_visits');
    expect(response.rows.find((row) => row.bucket === '0_5')?.repeatVisitRate).toBe(50);
    expect(response.rows.find((row) => row.bucket === '6_17')?.repeatVisitRate).toBe(0);
  });

  it('calculates each bucket share from total unique patients', () => {
    const response = buildPatientAgeAnalyticsResponse({ period, rows });
    expect(response.rows.find((row) => row.bucket === '0_5')?.patientShare).toBe(40);
    expect(response.rows.find((row) => row.bucket === '18_30')?.patientShare).toBe(60);
    expect(response.totals.patientShare).toBe(100);
  });

  it('declares service-date and Asia/Dhaka reporting metadata', () => {
    const response = buildPatientAgeAnalyticsResponse({ period, rows });
    expect(response.metadata).toMatchObject({
      contractVersion: 'patient-age-at-service-v1',
      grain: 'age_bucket',
      ageBasis: 'completed_years_at_service_date',
      dateBasis: 'service_date',
      timezone: 'Asia/Dhaka',
      moneyUnit: 'major',
      currencyCode: 'BDT',
    });
  });

  it('contains no patient identity fields in aggregate output', () => {
    const response = buildPatientAgeAnalyticsResponse({ period, rows });
    const serialized = JSON.stringify(response);
    for (const forbidden of ['patientName', 'patientCode', 'phone', 'address', 'nationalId']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('normalizes non-finite and negative measures without corrupting valid rows', () => {
    const response = buildPatientAgeAnalyticsResponse({
      period,
      rows: [{
        bucket: '31_45',
        uniquePatients: -1,
        visits: Number.NaN,
        admissions: 2.9,
        services: 4,
        billCount: 0,
        collection: Number.POSITIVE_INFINITY,
        repeatPatients: 5,
      }],
      warnings: ['Collection attribution is partial.'],
    });
    const row = response.rows.find((item) => item.bucket === '31_45');
    expect(row).toMatchObject({
      uniquePatients: 0,
      visits: 0,
      admissions: 2,
      services: 4,
      billCount: 0,
      collection: 0,
      repeatPatients: 0,
      averageBill: 0,
      repeatVisitRate: 0,
    });
    expect(response.warnings).toContain('Collection attribution is partial.');
  });
});

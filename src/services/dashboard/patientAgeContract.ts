import {
  PATIENT_AGE_BUCKET_ORDER,
  type PatientAgeBucket,
} from './patientAge';

export interface PatientAgeAnalyticsPeriod {
  startDate: string;
  endDate: string;
  label: string;
}

export interface PatientAgeAggregateInput {
  bucket: PatientAgeBucket;
  uniquePatients: number;
  visits: number;
  admissions: number;
  services: number;
  billCount: number;
  collection: number;
  repeatPatients: number;
}

export interface PatientAgeAggregateMetrics {
  uniquePatients: number;
  visits: number;
  admissions: number;
  services: number;
  billCount: number;
  collection: number;
  averageBill: number;
  repeatPatients: number;
  repeatVisitRate: number;
  patientShare: number;
}

export interface PatientAgeAggregateRow extends PatientAgeAggregateMetrics {
  bucket: PatientAgeBucket;
  label: string;
}

export interface PatientAgeAnalyticsResponse {
  period: PatientAgeAnalyticsPeriod;
  metadata: {
    contractVersion: 'patient-age-at-service-v1';
    grain: 'age_bucket';
    ageBasis: 'completed_years_at_service_date';
    dateBasis: 'service_date';
    timezone: 'Asia/Dhaka';
    moneyUnit: 'major';
    currencyCode: 'BDT';
    averageBillDenominator: 'unique_bills';
    repeatVisitRateNumerator: 'patients_with_multiple_visits';
    repeatVisitRateDenominator: 'unique_patients';
  };
  rows: PatientAgeAggregateRow[];
  totals: PatientAgeAggregateMetrics;
  warnings: string[];
}

interface BuildPatientAgeAnalyticsResponseInput {
  period: PatientAgeAnalyticsPeriod;
  rows?: readonly PatientAgeAggregateInput[];
  warnings?: readonly string[];
}

const BUCKET_LABELS: Record<PatientAgeBucket, string> = {
  '0_5': '0–5 years',
  '6_17': '6–17 years',
  '18_30': '18–30 years',
  '31_45': '31–45 years',
  '46_60': '46–60 years',
  '61_plus': '61+ years',
  unknown: 'Unknown age',
};

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

function nonNegativeMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round(((numerator / denominator) * 100 + Number.EPSILON) * 100) / 100;
}

function average(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator + Number.EPSILON) * 100) / 100;
}

interface AdditiveMetrics {
  uniquePatients: number;
  visits: number;
  admissions: number;
  services: number;
  billCount: number;
  collection: number;
  repeatPatients: number;
}

function emptyAdditiveMetrics(): AdditiveMetrics {
  return {
    uniquePatients: 0,
    visits: 0,
    admissions: 0,
    services: 0,
    billCount: 0,
    collection: 0,
    repeatPatients: 0,
  };
}

function mergeInput(target: AdditiveMetrics, input: PatientAgeAggregateInput): void {
  target.uniquePatients += nonNegativeInteger(input.uniquePatients);
  target.visits += nonNegativeInteger(input.visits);
  target.admissions += nonNegativeInteger(input.admissions);
  target.services += nonNegativeInteger(input.services);
  target.billCount += nonNegativeInteger(input.billCount);
  target.collection = nonNegativeMoney(target.collection + nonNegativeMoney(input.collection));
  target.repeatPatients += nonNegativeInteger(input.repeatPatients);
}

function finalizedMetrics(additive: AdditiveMetrics, totalUniquePatients: number): PatientAgeAggregateMetrics {
  const repeatPatients = Math.min(additive.uniquePatients, additive.repeatPatients);
  return {
    uniquePatients: additive.uniquePatients,
    visits: additive.visits,
    admissions: additive.admissions,
    services: additive.services,
    billCount: additive.billCount,
    collection: nonNegativeMoney(additive.collection),
    averageBill: average(additive.collection, additive.billCount),
    repeatPatients,
    repeatVisitRate: percentage(repeatPatients, additive.uniquePatients),
    patientShare: percentage(additive.uniquePatients, totalUniquePatients),
  };
}

export function buildPatientAgeAnalyticsResponse({
  period,
  rows = [],
  warnings = [],
}: BuildPatientAgeAnalyticsResponseInput): PatientAgeAnalyticsResponse {
  const byBucket = new Map<PatientAgeBucket, AdditiveMetrics>(
    PATIENT_AGE_BUCKET_ORDER.map((bucket) => [bucket, emptyAdditiveMetrics()]),
  );

  for (const row of rows) {
    const target = byBucket.get(row.bucket);
    if (target) mergeInput(target, row);
  }

  const totalsAdditive = emptyAdditiveMetrics();
  for (const bucket of PATIENT_AGE_BUCKET_ORDER) {
    const metrics = byBucket.get(bucket) ?? emptyAdditiveMetrics();
    totalsAdditive.uniquePatients += metrics.uniquePatients;
    totalsAdditive.visits += metrics.visits;
    totalsAdditive.admissions += metrics.admissions;
    totalsAdditive.services += metrics.services;
    totalsAdditive.billCount += metrics.billCount;
    totalsAdditive.collection = nonNegativeMoney(totalsAdditive.collection + metrics.collection);
    totalsAdditive.repeatPatients += Math.min(metrics.uniquePatients, metrics.repeatPatients);
  }

  const rowsOutput = PATIENT_AGE_BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: BUCKET_LABELS[bucket],
    ...finalizedMetrics(byBucket.get(bucket) ?? emptyAdditiveMetrics(), totalsAdditive.uniquePatients),
  }));

  const totals = finalizedMetrics(totalsAdditive, totalsAdditive.uniquePatients);
  totals.patientShare = totals.uniquePatients > 0 ? 100 : 0;

  return {
    period: { ...period },
    metadata: {
      contractVersion: 'patient-age-at-service-v1',
      grain: 'age_bucket',
      ageBasis: 'completed_years_at_service_date',
      dateBasis: 'service_date',
      timezone: 'Asia/Dhaka',
      moneyUnit: 'major',
      currencyCode: 'BDT',
      averageBillDenominator: 'unique_bills',
      repeatVisitRateNumerator: 'patients_with_multiple_visits',
      repeatVisitRateDenominator: 'unique_patients',
    },
    rows: rowsOutput,
    totals,
    warnings: [...warnings],
  };
}

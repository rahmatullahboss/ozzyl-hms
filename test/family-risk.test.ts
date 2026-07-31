import { describe, expect, it } from 'vitest';
import { buildChartFamilyRiskSummary, composeFamilyRiskOverview } from '../src/lib/family-risk';

describe('composeFamilyRiskOverview', () => {
  it('prioritizes first-degree chronic disease patterns and excludes non-biologic links', () => {
    const overview = composeFamilyRiskOverview([
      {
        relationship: 'parent',
        name: 'Father One',
        uhid: 'OZ-FAM-1',
        hospitalsCount: 2,
        diagnoses: [
          { description: 'Type 2 diabetes mellitus', icd10Code: 'E11' },
          { description: 'Essential hypertension', icd10Code: 'I10' },
        ],
      },
      {
        relationship: 'grandparent',
        name: 'Grandmother One',
        uhid: 'OZ-FAM-2',
        hospitalsCount: 1,
        diagnoses: [
          { description: 'Stroke', icd10Code: 'I63' },
        ],
      },
      {
        relationship: 'spouse',
        name: 'Spouse One',
        uhid: 'OZ-FAM-3',
        hospitalsCount: 1,
        diagnoses: [
          { description: 'Type 2 diabetes mellitus', icd10Code: 'E11' },
        ],
      },
    ]);

    expect(overview.status).toBe('attention');
    expect(overview.insights[0]?.domain).toBe('diabetes');
    expect(overview.insights[0]?.first_degree_count).toBe(1);
    expect(overview.insights.some((item) => item.domain === 'stroke')).toBe(true);
    expect(overview.insights[0]?.matched_relatives.some((item) => item.relationship === 'spouse')).toBe(false);
  });

  it('returns stable output when no biologic diagnoses are linked yet', () => {
    const overview = composeFamilyRiskOverview([
      {
        relationship: 'caregiver',
        name: 'Helper',
        uhid: 'OZ-FAM-9',
        hospitalsCount: 0,
        diagnoses: [{ description: 'Asthma', icd10Code: 'J45' }],
      },
    ]);

    expect(overview.status).toBe('stable');
    expect(overview.insights).toHaveLength(0);
    expect(overview.headline.toLowerCase()).toContain('no recorded');
  });

  it('builds chart-oriented screening prompts and stronger scoring for first-degree patterns', () => {
    const overview = composeFamilyRiskOverview([
      {
        relationship: 'parent',
        name: 'Father One',
        uhid: 'OZ-FAM-1',
        hospitalsCount: 2,
        diagnoses: [
          { description: 'Type 2 diabetes mellitus', icd10Code: 'E11' },
          { description: 'Essential hypertension', icd10Code: 'I10' },
        ],
      },
      {
        relationship: 'sibling',
        name: 'Brother One',
        uhid: 'OZ-FAM-2',
        hospitalsCount: 1,
        diagnoses: [
          { description: 'Type 2 diabetes mellitus', icd10Code: 'E11' },
        ],
      },
    ]);

    const chart = buildChartFamilyRiskSummary(overview, {
      age: 29,
      activeProblems: ['Obesity'],
      latestVitals: { systolic: 148, diastolic: 94, blood_sugar: 112 },
    });

    expect(chart?.headline.toLowerCase()).toContain('preventive');
    expect(chart?.insights[0]?.domain).toBe('diabetes');
    expect(chart?.insights[0]?.risk_score).toBeGreaterThanOrEqual(5);
    expect(chart?.insights[0]?.screening_priority).toBe('high_attention');
    expect(chart?.insights[0]?.screening_prompts.join(' ').toLowerCase()).toContain('hba1c');
    expect(chart?.insights.some((item) => item.domain === 'hypertension')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { composeDeterministicChartSummary, sanitizeAiSummaryOutput } from '../src/lib/chart-ai-summary';

describe('composeDeterministicChartSummary', () => {
  it('prioritizes unstable clinical issues and patient-reported context with provenance', () => {
    const result = composeDeterministicChartSummary({
      allergies: [{ allergen: 'Penicillin', severity: 'severe', review_status: 'verified', verified_at: '2026-04-01' }],
      activeProblems: [{ description: 'Type 2 diabetes mellitus', severity: 'moderate', status: 'active' }],
      currentMedications: [{ medication_name: 'Metformin', status: 'active', source: 'prescribed', review_status: 'verified' }],
      stoppedMedications: [],
      adverseReactions: [{ id: 5, medication_name: 'Ibuprofen', reaction: 'Severe acidity', severity: 'severe', review_status: 'pending_review' }],
      lifestyleLogs: [{ id: 7, logged_on: '2026-04-10', sleep_hours: 4, symptom_score: 8, symptoms: 'Headache and fatigue', mood: 'low', review_status: 'pending_review' }],
      abnormalLabs: [{ id: 11, test_name: 'CRP', abnormal_flag: 'critical', result: '18.5' }],
      latestVitals: { systolic: 170, diastolic: 102, blood_sugar: 280, temperature: 101.2 },
      activeConsultation: { id: 3, status: 'in_progress', chief_complaint: 'Fever with uncontrolled diabetes' },
      hasScheduledFollowUp: false,
      hasUnverifiedAllergy: false,
      familyRiskOverview: null,
      citationSources: [
        { id: 'consultation-3', type: 'consultation', date: '2026-04-10', title: 'Consultation', subtitle: 'Fever with uncontrolled diabetes', status: 'in_progress' },
        { id: 'adr-5', type: 'patient_reported_adr', date: '2026-04-10', title: 'ADR', subtitle: 'Severe acidity', status: 'pending_review' },
        { id: 'lifestyle-7', type: 'patient_reported_lifestyle', date: '2026-04-10', title: 'Lifestyle', subtitle: 'Headache and fatigue', status: 'pending_review' },
        { id: 'lab-11', type: 'lab', date: '2026-04-10', title: 'CRP', subtitle: 'critical', status: 'completed' },
      ],
    });

    expect(result.oneLiner.toLowerCase()).toContain('uncontrolled');
    expect(result.activeIssues[0]?.priority).toBe('critical');
    expect(result.patientContext.some((item) => item.provenance === 'patient_reported')).toBe(true);
    expect(result.cautions.some((item) => item.text.toLowerCase().includes('patient-reported'))).toBe(true);
    expect(result.followUpRisks.some((item) => item.text.toLowerCase().includes('follow-up'))).toBe(true);
  });

  it('surfaces medication focus and provenance flags for pending patient-reported signals', () => {
    const result = composeDeterministicChartSummary({
      allergies: [],
      activeProblems: [{ description: 'Hypertension', severity: 'moderate', status: 'active' }],
      currentMedications: [
        { medication_name: 'Amlodipine', status: 'active', source: 'prescribed', review_status: 'verified' },
        { medication_name: 'Salbutamol Inhaler', status: 'on_hold', source: 'prescribed', review_status: 'pending_review', status_reason: 'Hold pending reassessment' },
      ],
      stoppedMedications: [{ medication_name: 'Losartan', generic_name: 'Losartan', status: 'completed' }],
      adverseReactions: [],
      lifestyleLogs: [{ id: 8, logged_on: '2026-04-09', sleep_hours: 5, symptom_score: 5, symptoms: 'Fatigue', mood: 'low', review_status: 'pending_review' }],
      abnormalLabs: [],
      latestVitals: { systolic: 150, diastolic: 94, blood_sugar: 0, temperature: 98.6 },
      activeConsultation: null,
      hasScheduledFollowUp: false,
      hasUnverifiedAllergy: true,
      familyRiskOverview: {
        status: 'attention',
        headline: 'Earlier screening deserves attention.',
        summary: 'Close family history and current risk context suggest earlier screening conversations.',
        guidance: ['Tell the doctor about diabetes in the family.'],
        insights: [
          {
            domain: 'diabetes',
            label: 'Diabetes pattern in family',
            severity: 'elevated',
            rationale: '1 first-degree relative has recorded diagnoses in this pattern.',
            why_it_matters: 'Family diabetes history can matter for earlier blood sugar screening.',
            relative_count: 1,
            first_degree_count: 1,
            matched_relatives: [{ relationship: 'parent', name: 'Father One', diagnosis: 'Type 2 diabetes mellitus', hospitalsCount: 2, uhid: 'OZ-FAM-1', icd10Code: 'E11' }],
            next_steps: ['Tell the doctor that diabetes exists in the family.'],
            risk_score: 6,
            screening_priority: 'earlier',
            screening_prompts: ['Consider HbA1c or fasting blood sugar screening earlier than usual.'],
            care_context: 'First-degree diabetes history is present and the patient has current metabolic or blood-pressure signals.',
          },
        ],
      },
      citationSources: [
        { id: 'medication-33', type: 'medication', date: '2026-04-09', title: 'Medication', subtitle: 'on hold', status: 'on_hold' },
        { id: 'lifestyle-8', type: 'patient_reported_lifestyle', date: '2026-04-09', title: 'Lifestyle', subtitle: 'Fatigue', status: 'pending_review' },
        { id: 'family-risk-1', type: 'family_risk', date: '2026-04-10', title: 'Diabetes pattern in family', subtitle: '1 first-degree relative', status: 'attention' },
      ],
    });

    expect(result.medicationFocus.some((item) => item.text.includes('on hold'))).toBe(true);
    expect(result.provenanceFlags.some((item) => item.text.toLowerCase().includes('pending review'))).toBe(true);
    expect(result.cautions.some((item) => item.text.toLowerCase().includes('unverified allergy'))).toBe(true);
    expect(result.familyHistory?.[0]?.text.toLowerCase()).toContain('family');
    expect(result.familyHistory?.[0]?.citationIds).toEqual(['family-risk-1']);
    expect(result.followUpRisks.some((item) => item.text.toLowerCase().includes('screening'))).toBe(true);
  });
});

describe('sanitizeAiSummaryOutput', () => {
  it('keeps only whitelisted citations and falls back on invalid sections', () => {
    const fallback = composeDeterministicChartSummary({
      allergies: [],
      activeProblems: [],
      currentMedications: [],
      stoppedMedications: [],
      adverseReactions: [],
      lifestyleLogs: [],
      abnormalLabs: [],
      latestVitals: null,
      activeConsultation: null,
      hasScheduledFollowUp: true,
      hasUnverifiedAllergy: false,
      familyRiskOverview: null,
      citationSources: [{ id: 'consultation-1', type: 'consultation', date: '2026-04-01', title: 'Consult', subtitle: '', status: 'completed' }],
    });

    const result = sanitizeAiSummaryOutput({
      oneLiner: 'AI one liner',
      activeIssues: [{ text: 'Unsafe issue', priority: 'critical', citationIds: ['bad-id'], provenance: 'patient_reported' }],
      recentChanges: [{ text: 'Consult reviewed', priority: 'high', citationIds: ['consultation-1'], provenance: 'clinician_entered' }],
    }, new Set(['consultation-1']), fallback);

    expect(result.oneLiner).toBe('AI one liner');
    expect(result.activeIssues).toEqual(fallback.activeIssues);
    expect(result.recentChanges[0]?.citationIds).toEqual(['consultation-1']);
  });
});

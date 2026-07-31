import type { D1Database } from '@cloudflare/workers-types';
import type { FamilyRelationship } from './family-graph';
import { resolvePatientLinksForIdentity } from './family-graph';

export type FamilyRiskSeverity = 'watch' | 'elevated';
export type FamilyRiskStatus = 'stable' | 'watch' | 'attention';

export interface FamilyRiskEvidence {
  relationship: FamilyRelationship | string;
  name: string | null;
  uhid: string | null;
  hospitalsCount: number;
  diagnosis: string | null;
  icd10Code: string | null;
}

export interface FamilyRiskProfile {
  relationship: FamilyRelationship | string;
  name: string | null;
  uhid: string | null;
  hospitalsCount: number;
  diagnoses: Array<{
    description: string | null;
    icd10Code: string | null;
  }>;
}

export interface FamilyRiskInsight {
  domain: string;
  label: string;
  severity: FamilyRiskSeverity;
  rationale: string;
  why_it_matters: string;
  relative_count: number;
  first_degree_count: number;
  matched_relatives: FamilyRiskEvidence[];
  next_steps: string[];
  risk_score?: number;
  screening_priority?: 'routine' | 'earlier' | 'high_attention';
  screening_prompts?: string[];
  care_context?: string;
}

export interface FamilyRiskOverview {
  status: FamilyRiskStatus;
  headline: string;
  summary: string;
  guidance: string[];
  insights: FamilyRiskInsight[];
}

export interface ChartFamilyRiskContext {
  age?: number | null;
  activeProblems?: string[];
  latestVitals?: Record<string, unknown> | null;
}

export interface FamilyRiskCitationSource {
  id: string;
  type: 'family_risk';
  date: string;
  title: string;
  subtitle: string;
  status: string;
}

interface FamilyRiskRule {
  domain: string;
  label: string;
  whyItMatters: string;
  nextSteps: string[];
  icd10Prefixes: string[];
  keywords: string[];
}

const FIRST_DEGREE_RELATIONSHIPS = new Set<FamilyRelationship | string>([
  'parent',
  'child',
  'sibling',
]);

const BIOLOGIC_RELATIONSHIPS = new Set<FamilyRelationship | string>([
  'parent',
  'child',
  'sibling',
  'grandparent',
  'grandchild',
]);

const RISK_RULES: FamilyRiskRule[] = [
  {
    domain: 'diabetes',
    label: 'Diabetes pattern in family',
    whyItMatters: 'Family diabetes history can matter for earlier blood sugar screening and day-to-day prevention planning.',
    nextSteps: [
      'Tell the doctor that diabetes exists in the family so screening can be planned earlier if needed.',
      'Keep weight, food habits, and blood pressure follow-up up to date.',
    ],
    icd10Prefixes: ['E10', 'E11', 'E12', 'E13', 'E14'],
    keywords: ['diabetes', 'diabetic', 'prediabetes'],
  },
  {
    domain: 'heart_disease',
    label: 'Heart disease pattern in family',
    whyItMatters: 'Family heart disease history can raise attention on blood pressure, cholesterol, smoking, and other cardiovascular risk factors.',
    nextSteps: [
      'Mention family heart disease before routine checkups or medicine reviews.',
      'Keep blood pressure, cholesterol, diabetes, and smoking risk discussions up to date.',
    ],
    icd10Prefixes: ['I20', 'I21', 'I22', 'I23', 'I24', 'I25', 'I50'],
    keywords: ['heart attack', 'coronary', 'ischemic heart', 'angina', 'myocardial', 'heart failure'],
  },
  {
    domain: 'stroke',
    label: 'Stroke pattern in family',
    whyItMatters: 'Family stroke history should prompt attention to blood pressure, diabetes, smoking, and urgent symptom awareness.',
    nextSteps: [
      'Tell the doctor that stroke exists in the family, especially during blood pressure follow-up.',
      'Review blood pressure, diabetes, and smoking risks early instead of waiting for symptoms.',
    ],
    icd10Prefixes: ['I60', 'I61', 'I62', 'I63', 'I64', 'I65', 'I66', 'I67', 'I68', 'I69'],
    keywords: ['stroke', 'cva', 'brain attack', 'cerebrovascular'],
  },
  {
    domain: 'hypertension',
    label: 'Blood pressure pattern in family',
    whyItMatters: 'Repeated high blood pressure in close relatives is useful context for long-term heart and kidney protection.',
    nextSteps: [
      'Keep routine blood pressure checks active even if you feel well.',
      'Bring family blood pressure history up during general medicine visits.',
    ],
    icd10Prefixes: ['I10', 'I11', 'I12', 'I13', 'I15'],
    keywords: ['hypertension', 'high blood pressure'],
  },
  {
    domain: 'asthma',
    label: 'Asthma or airway pattern in family',
    whyItMatters: 'Family asthma history can help explain repeated breathing symptoms and support faster preventive review.',
    nextSteps: [
      'Tell the doctor if wheeze, allergies, or breathing attacks run in the family.',
      'Keep triggers, inhaler history, and seasonal breathing symptoms documented.',
    ],
    icd10Prefixes: ['J45', 'J46'],
    keywords: ['asthma', 'wheeze', 'reactive airway'],
  },
  {
    domain: 'kidney_disease',
    label: 'Kidney disease pattern in family',
    whyItMatters: 'Family kidney disease history should increase attention to diabetes, blood pressure, and kidney function follow-up.',
    nextSteps: [
      'Tell the doctor about kidney disease in close relatives before lab review.',
      'Keep blood pressure, diabetes, and kidney test follow-up current if advised.',
    ],
    icd10Prefixes: ['N18', 'N19', 'N17'],
    keywords: ['kidney disease', 'ckd', 'renal failure', 'kidney failure'],
  },
];

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isBiologicRelationship(relationship: string): boolean {
  return BIOLOGIC_RELATIONSHIPS.has(relationship);
}

function isFirstDegreeRelationship(relationship: string): boolean {
  return FIRST_DEGREE_RELATIONSHIPS.has(relationship);
}

function matchesRule(
  diagnosis: { description: string | null; icd10Code: string | null },
  rule: FamilyRiskRule,
): boolean {
  const code = normalizeText(diagnosis.icd10Code).toUpperCase();
  const description = normalizeText(diagnosis.description);

  if (rule.icd10Prefixes.some((prefix) => code.startsWith(prefix))) {
    return true;
  }

  return rule.keywords.some((keyword) => description.includes(keyword));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function domainMatchesPatientProblem(domain: string, activeProblems: string[]): boolean {
  const haystack = activeProblems.map((item) => normalizeText(item)).join(' | ');
  switch (domain) {
    case 'diabetes':
      return haystack.includes('diabetes');
    case 'heart_disease':
      return haystack.includes('heart') || haystack.includes('ischemic') || haystack.includes('coronary');
    case 'stroke':
      return haystack.includes('stroke') || haystack.includes('cva') || haystack.includes('cerebrovascular');
    case 'hypertension':
      return haystack.includes('hypertension') || haystack.includes('blood pressure');
    case 'asthma':
      return haystack.includes('asthma') || haystack.includes('wheeze');
    case 'kidney_disease':
      return haystack.includes('kidney') || haystack.includes('ckd') || haystack.includes('renal');
    default:
      return false;
  }
}

function domainScreeningPrompts(domain: string): string[] {
  switch (domain) {
    case 'diabetes':
      return [
        'Consider HbA1c or fasting blood sugar screening earlier than usual.',
        'Review weight, waistline, diet, and blood pressure together instead of treating them separately.',
      ];
    case 'heart_disease':
      return [
        'Consider earlier lipid review, blood pressure follow-up, and smoking-risk review.',
        'Document family premature cardiac history before long-term risk counselling.',
      ];
    case 'stroke':
      return [
        'Treat blood pressure review and urgent neuro-symptom counselling as higher-value preventive work.',
        'Review diabetes, smoking, and vascular risk factors early if symptoms or risk markers are present.',
      ];
    case 'hypertension':
      return [
        'Keep serial blood pressure checks active even if the patient feels well.',
        'Consider home or repeat clinic BP review before delaying follow-up.',
      ];
    case 'asthma':
      return [
        'Ask directly about wheeze, triggers, allergic history, and inhaler use if respiratory symptoms recur.',
        'Document seasonal symptom patterns and exposure triggers early.',
      ];
    case 'kidney_disease':
      return [
        'Consider earlier creatinine, eGFR, urine albumin, and blood pressure review if other risk factors exist.',
        'Watch diabetes and hypertension control closely because the family pattern raises long-term kidney risk context.',
      ];
    default:
      return [];
  }
}

export function buildChartFamilyRiskSummary(
  overview: FamilyRiskOverview | null,
  context: ChartFamilyRiskContext,
): FamilyRiskOverview | null {
  if (!overview || overview.insights.length === 0) return overview;

  const age = Number(context.age ?? 0);
  const activeProblems = context.activeProblems ?? [];
  const systolic = Number(context.latestVitals?.systolic ?? 0);
  const diastolic = Number(context.latestVitals?.diastolic ?? 0);
  const bloodSugar = Number(context.latestVitals?.blood_sugar ?? 0);

  const insights = overview.insights.map((insight) => {
    const patientAlreadyHasDomain = domainMatchesPatientProblem(insight.domain, activeProblems);
    const hasCurrentRiskSignal =
      (insight.domain === 'diabetes' && (bloodSugar >= 100 || age >= 25)) ||
      ((insight.domain === 'heart_disease' || insight.domain === 'stroke' || insight.domain === 'hypertension' || insight.domain === 'kidney_disease')
        && (systolic >= 130 || diastolic >= 85 || age >= 30)) ||
      (insight.domain === 'asthma' && age <= 40);

    const riskScore =
      (insight.first_degree_count * 2) +
      Math.max(0, insight.relative_count - insight.first_degree_count) +
      (insight.severity === 'elevated' ? 1 : 0) +
      (patientAlreadyHasDomain ? 0 : 1) +
      (hasCurrentRiskSignal ? 1 : 0);

    const screeningPriority: 'routine' | 'earlier' | 'high_attention' =
      riskScore >= 7 ? 'high_attention' : riskScore >= 4 ? 'earlier' : 'routine';

    const careContextBits = [
      insight.first_degree_count > 0 ? 'first-degree family history is present' : 'biologic family history is present',
      patientAlreadyHasDomain ? 'the patient already carries related disease on the chart' : 'the patient does not yet carry the same disease on the active chart',
      hasCurrentRiskSignal ? 'current age or vital-risk context makes earlier screening more useful' : 'current chart context does not yet add extra urgency',
    ];

    return {
      ...insight,
      risk_score: riskScore,
      screening_priority: screeningPriority,
      screening_prompts: domainScreeningPrompts(insight.domain),
      care_context: `${careContextBits.join('; ')}.`,
    };
  }).sort((a, b) => {
    const priorityRank = { high_attention: 0, earlier: 1, routine: 2 };
    const aPriority = priorityRank[a.screening_priority ?? 'routine'];
    const bPriority = priorityRank[b.screening_priority ?? 'routine'];
    if (aPriority !== bPriority) return aPriority - bPriority;
    return Number(b.risk_score ?? 0) - Number(a.risk_score ?? 0);
  });

  const top = insights[0];
  const headline =
    top?.screening_priority === 'high_attention'
      ? 'Family history deserves high-attention preventive follow-up.'
      : top?.screening_priority === 'earlier'
        ? 'Family history suggests earlier screening conversations.'
        : overview.headline;

  const summary = top
    ? `${top.label}: ${top.care_context} Use this as non-diagnostic preventive context, not as a diagnosis.`
    : overview.summary;

  const guidance = uniqueStrings([
    ...overview.guidance,
    ...insights.flatMap((item) => item.screening_prompts ?? []),
  ]).slice(0, 5);

  return {
    ...overview,
    headline,
    summary,
    guidance,
    insights,
  };
}

export function composeFamilyRiskOverview(profiles: FamilyRiskProfile[]): FamilyRiskOverview {
  const insights: FamilyRiskInsight[] = [];

  for (const rule of RISK_RULES) {
    const matchedRelatives: FamilyRiskEvidence[] = [];

    for (const profile of profiles) {
      const relationship = String(profile.relationship ?? '');
      if (!isBiologicRelationship(relationship)) continue;

      const matchedDiagnosis = profile.diagnoses.find((diagnosis) => matchesRule(diagnosis, rule));
      if (!matchedDiagnosis) continue;

      matchedRelatives.push({
        relationship,
        name: profile.name,
        uhid: profile.uhid,
        hospitalsCount: profile.hospitalsCount,
        diagnosis: matchedDiagnosis.description,
        icd10Code: matchedDiagnosis.icd10Code,
      });
    }

    if (matchedRelatives.length === 0) continue;

    const firstDegreeCount = matchedRelatives.filter((item) => isFirstDegreeRelationship(String(item.relationship))).length;
    const severity: FamilyRiskSeverity = firstDegreeCount > 0 || matchedRelatives.length > 1 ? 'elevated' : 'watch';

    const rationaleBits = [
      firstDegreeCount > 0
        ? `${firstDegreeCount} first-degree relative${firstDegreeCount > 1 ? 's' : ''}`
        : `${matchedRelatives.length} biologic relative${matchedRelatives.length > 1 ? 's' : ''}`,
      'has recorded diagnoses in this pattern',
    ];

    insights.push({
      domain: rule.domain,
      label: rule.label,
      severity,
      rationale: `${rationaleBits.join(' ')}.`,
      why_it_matters: rule.whyItMatters,
      relative_count: matchedRelatives.length,
      first_degree_count: firstDegreeCount,
      matched_relatives: matchedRelatives,
      next_steps: rule.nextSteps,
    });
  }

  insights.sort((a, b) => {
    const severityOrder = { elevated: 0, watch: 1 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    if (b.first_degree_count !== a.first_degree_count) {
      return b.first_degree_count - a.first_degree_count;
    }
    return b.relative_count - a.relative_count;
  });

  const status: FamilyRiskStatus = insights.some((item) => item.severity === 'elevated')
    ? 'attention'
    : insights.length > 0
      ? 'watch'
      : 'stable';

  if (insights.length === 0) {
    return {
      status,
      headline: 'No recorded family-pattern alerts yet.',
      summary: 'As more hospital diagnoses are linked to your managed family profiles, the system will surface family history watch items here.',
      guidance: [
        'Link existing health cards for parents or elders instead of creating duplicate profiles.',
        'Tell hospitals to keep diagnoses and medicines updated so family risk context stays useful.',
      ],
      insights: [],
    };
  }

  const topLabels = insights.slice(0, 3).map((item) => item.label.toLowerCase());
  const guidance = uniqueStrings(insights.flatMap((item) => item.next_steps)).slice(0, 4);

  return {
    status,
    headline: `${insights.length} family risk pattern${insights.length > 1 ? 's' : ''} deserve attention.`,
    summary: `Recorded family diagnoses suggest watch areas around ${topLabels.join(', ')}. These are not diagnoses, but they are useful context for screening and prevention.`,
    guidance,
    insights,
  };
}

export async function loadDiagnosesForPatientLink(
  db: D1Database,
  tenantId: string,
  patientId: number,
): Promise<Array<{ description: string | null; icd10Code: string | null }>> {
  const [clinicalDiagnoses, finalDiagnoses] = await Promise.all([
    db.prepare(`
      SELECT COALESCE(icd11_title, ICD10Description, Notes) AS description, ICD10Code AS icd10_code
      FROM ClinicalDiagnosis
      WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
      ORDER BY datetime(CreatedOn) DESC
      LIMIT 12
    `).bind(tenantId, patientId).all<{ description: string | null; icd10_code: string | null }>(),
    db.prepare(`
      SELECT COALESCE(fd.icd11_title, ic.description, fd.notes) AS description, ic.code AS icd10_code
      FROM final_diagnosis fd
      LEFT JOIN icd10_codes ic ON ic.id = fd.icd10_id
      WHERE fd.tenant_id = ? AND fd.patient_id = ? AND fd.is_active = 1
      ORDER BY datetime(fd.created_at) DESC
      LIMIT 12
    `).bind(tenantId, patientId).all<{ description: string | null; icd10_code: string | null }>(),
  ]);

  return [...(clinicalDiagnoses.results ?? []), ...(finalDiagnoses.results ?? [])].map((row) => ({
    description: row.description ? String(row.description) : null,
    icd10Code: row.icd10_code ? String(row.icd10_code) : null,
  }));
}

function invertRelationship(relationship: string): FamilyRelationship | 'other' {
  switch (relationship) {
    case 'child':
      return 'parent';
    case 'parent':
      return 'child';
    case 'grandchild':
      return 'grandparent';
    case 'grandparent':
      return 'grandchild';
    case 'sibling':
      return 'sibling';
    case 'spouse':
      return 'spouse';
    default:
      return 'other';
  }
}

export async function loadChartFamilyRiskOverview(
  db: D1Database,
  patientUhid: string | null | undefined,
): Promise<FamilyRiskOverview | null> {
  if (!patientUhid) return null;

  const selfIdentity = await db.prepare(`
    SELECT id, claim_status, claimed_auth_user_id
    FROM global_patient_identity
    WHERE uhid = ?
    LIMIT 1
  `).bind(patientUhid).first<{ id: number; claim_status: string | null; claimed_auth_user_id: number | null }>();

  if (!selfIdentity) return null;

  const profiles: FamilyRiskProfile[] = [];
  const seenIdentityIds = new Set<number>([selfIdentity.id]);

  const authRows = await db.prepare(`
    SELECT id
    FROM global_patient_auth
    WHERE identity_id = ? AND is_active = 1
  `).bind(selfIdentity.id).all<{ id: number }>();

  for (const authRow of authRows.results ?? []) {
    const linkedRows = await db.prepare(`
      SELECT gfl.patient_identity_id, gfl.relationship, gpi.uhid, gpi.primary_name
      FROM global_family_links gfl
      JOIN global_patient_identity gpi ON gpi.id = gfl.patient_identity_id
      WHERE gfl.manager_auth_user_id = ? AND gfl.status = 'active' AND gfl.patient_identity_id != ?
    `).bind(authRow.id, selfIdentity.id).all<{
      patient_identity_id: number;
      relationship: string;
      uhid: string | null;
      primary_name: string | null;
    }>();

    for (const row of linkedRows.results ?? []) {
      if (seenIdentityIds.has(Number(row.patient_identity_id))) continue;
      seenIdentityIds.add(Number(row.patient_identity_id));

      const hospitalLinks = await resolvePatientLinksForIdentity(db, {
        uhid: row.uhid ? String(row.uhid) : null,
        primaryPhone: null,
        primaryEmail: null,
      });
      const diagnoses = (
        await Promise.all(hospitalLinks.map((link) => loadDiagnosesForPatientLink(db, link.tenantId, link.patientId)))
      ).flat();

      profiles.push({
        relationship: String(row.relationship),
        name: row.primary_name ? String(row.primary_name) : null,
        uhid: row.uhid ? String(row.uhid) : null,
        hospitalsCount: hospitalLinks.length,
        diagnoses,
      });
    }
  }

  const managerRows = await db.prepare(`
    SELECT manager_auth_user_id, relationship
    FROM global_family_links
    WHERE patient_identity_id = ? AND status = 'active'
  `).bind(selfIdentity.id).all<{ manager_auth_user_id: number; relationship: string }>();

  for (const managerRow of managerRows.results ?? []) {
    const managerIdentity = await db.prepare(`
      SELECT gpa.identity_id, gpi.uhid, gpi.primary_name
      FROM global_patient_auth gpa
      JOIN global_patient_identity gpi ON gpi.id = gpa.identity_id
      WHERE gpa.id = ? AND gpa.is_active = 1
      LIMIT 1
    `).bind(managerRow.manager_auth_user_id).first<{
      identity_id: number;
      uhid: string | null;
      primary_name: string | null;
    }>();

    if (!managerIdentity || seenIdentityIds.has(Number(managerIdentity.identity_id))) continue;
    seenIdentityIds.add(Number(managerIdentity.identity_id));

    const hospitalLinks = await resolvePatientLinksForIdentity(db, {
      uhid: managerIdentity.uhid ? String(managerIdentity.uhid) : null,
      primaryPhone: null,
      primaryEmail: null,
    });
    const diagnoses = (
      await Promise.all(hospitalLinks.map((link) => loadDiagnosesForPatientLink(db, link.tenantId, link.patientId)))
    ).flat();

    profiles.push({
      relationship: invertRelationship(String(managerRow.relationship ?? 'other')),
      name: managerIdentity.primary_name ? String(managerIdentity.primary_name) : null,
      uhid: managerIdentity.uhid ? String(managerIdentity.uhid) : null,
      hospitalsCount: hospitalLinks.length,
      diagnoses,
    });
  }

  return composeFamilyRiskOverview(profiles);
}

export function buildFamilyRiskCitationSources(overview: FamilyRiskOverview | null): FamilyRiskCitationSource[] {
  if (!overview || overview.insights.length === 0) return [];

  const now = new Date().toISOString();
  return overview.insights.slice(0, 4).map((insight, index) => ({
    id: `family-risk-${index + 1}`,
    type: 'family_risk',
    date: now,
    title: insight.label,
    subtitle: insight.rationale,
    status: overview.status,
  }));
}

export function getFamilyRiskInsightBySourceId(
  overview: FamilyRiskOverview | null,
  sourceId: string,
): FamilyRiskInsight | null {
  if (!overview) return null;
  const match = /^family-risk-(\d+)$/.exec(sourceId);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  return overview.insights[index] ?? null;
}

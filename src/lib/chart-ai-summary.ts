export type SummaryPriority = 'critical' | 'high' | 'medium' | 'info';
export type SummaryProvenance = 'clinician_verified' | 'clinician_entered' | 'patient_reported' | 'mixed';

export interface CitationSource {
  id: string;
  type: string;
  date: string;
  title: string;
  subtitle: string;
  status: string;
}

export interface PhysicianSummaryItem {
  text: string;
  priority: SummaryPriority;
  citationIds: string[];
  provenance: SummaryProvenance;
}

export interface PhysicianSummary {
  oneLiner: string;
  activeIssues: PhysicianSummaryItem[];
  familyHistory: PhysicianSummaryItem[];
  patientContext: PhysicianSummaryItem[];
  recentChanges: PhysicianSummaryItem[];
  medicationFocus: PhysicianSummaryItem[];
  abnormalFindings: PhysicianSummaryItem[];
  followUpRisks: PhysicianSummaryItem[];
  cautions: PhysicianSummaryItem[];
  provenanceFlags: PhysicianSummaryItem[];
}

type PhysicianSummaryListKey = Exclude<keyof PhysicianSummary, 'oneLiner'>;

interface ComposeInput {
  allergies: Array<Record<string, unknown>>;
  activeProblems: Array<Record<string, unknown>>;
  currentMedications: Array<Record<string, unknown>>;
  stoppedMedications: Array<Record<string, unknown>>;
  adverseReactions: Array<Record<string, unknown>>;
  lifestyleLogs: Array<Record<string, unknown>>;
  abnormalLabs: Array<Record<string, unknown>>;
  latestVitals: Record<string, unknown> | null;
  activeConsultation: Record<string, unknown> | null;
  hasScheduledFollowUp: boolean;
  hasUnverifiedAllergy: boolean;
  familyRiskOverview: {
    status: string;
    insights: Array<{
      label: string;
      severity: string;
      rationale: string;
      first_degree_count: number;
      relative_count: number;
      care_context?: string;
      screening_priority?: string;
      screening_prompts?: string[];
    }>;
  } | null;
  citationSources: CitationSource[];
}

function findCitationId(citationSources: CitationSource[], prefixes: string[]): string[] {
  const match = citationSources.find((item) => prefixes.some((prefix) => item.id.startsWith(prefix)));
  return match ? [match.id] : [];
}

function normalizeReviewStatus(value: unknown): 'pending_review' | 'verified' | 'rejected' {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'verified' || normalized === 'rejected') return normalized;
  return 'pending_review';
}

function pushItem(
  items: PhysicianSummaryItem[],
  text: string,
  priority: SummaryPriority,
  citationIds: string[],
  provenance: SummaryProvenance,
): void {
  if (!text.trim()) return;
  items.push({ text, priority, citationIds, provenance });
}

function topText(items: PhysicianSummaryItem[]): string {
  return items[0]?.text ?? 'No major active issues highlighted.';
}

function sortItems(items: PhysicianSummaryItem[]): PhysicianSummaryItem[] {
  const rank: Record<SummaryPriority, number> = { critical: 0, high: 1, medium: 2, info: 3 };
  return [...items].sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, 5);
}

export function composeDeterministicChartSummary(input: ComposeInput): PhysicianSummary {
  const activeIssues: PhysicianSummaryItem[] = [];
  const familyHistory: PhysicianSummaryItem[] = [];
  const patientContext: PhysicianSummaryItem[] = [];
  const recentChanges: PhysicianSummaryItem[] = [];
  const medicationFocus: PhysicianSummaryItem[] = [];
  const abnormalFindings: PhysicianSummaryItem[] = [];
  const followUpRisks: PhysicianSummaryItem[] = [];
  const cautions: PhysicianSummaryItem[] = [];
  const provenanceFlags: PhysicianSummaryItem[] = [];

  const systolic = Number(input.latestVitals?.systolic ?? 0);
  const diastolic = Number(input.latestVitals?.diastolic ?? 0);
  const bloodSugar = Number(input.latestVitals?.blood_sugar ?? 0);
  const temperature = Number(input.latestVitals?.temperature ?? 0);

  if (systolic >= 160 || diastolic >= 100 || bloodSugar >= 250 || temperature >= 101) {
    pushItem(
      activeIssues,
      `Uncontrolled acute parameters: BP ${systolic || 'n/a'}/${diastolic || 'n/a'}, blood sugar ${bloodSugar || 'n/a'}, temperature ${temperature || 'n/a'}.`,
      'critical',
      findCitationId(input.citationSources, ['consultation-', 'lab-']),
      'clinician_entered',
    );
  }

  const criticalLab = input.abnormalLabs.find((item) => String(item.abnormal_flag ?? '').toLowerCase() === 'critical');
  if (criticalLab) {
    pushItem(
      abnormalFindings,
      `${String(criticalLab.test_name ?? 'Critical lab')} is flagged critical with result ${String(criticalLab.result ?? 'n/a')}.`,
      'critical',
      findCitationId(input.citationSources, ['lab-']),
      'clinician_entered',
    );
  }

  if (input.activeConsultation) {
    pushItem(
      recentChanges,
      `Active consultation in progress for ${String(input.activeConsultation.chief_complaint ?? 'current symptoms')}.`,
      'high',
      findCitationId(input.citationSources, ['consultation-']),
      'clinician_entered',
    );
  }

  const severeAdr = input.adverseReactions.find((item) => String(item.severity ?? '').toLowerCase() === 'severe');
  if (severeAdr) {
    pushItem(
      patientContext,
      `Patient-reported severe reaction to ${String(severeAdr.medication_name ?? severeAdr.generic_name ?? 'a medicine')}: ${String(severeAdr.reaction ?? 'reaction reported')}.`,
      'high',
      findCitationId(input.citationSources, [`adr-${String(severeAdr.id ?? '')}`]),
      'patient_reported',
    );
  }

  const poorSleep = input.lifestyleLogs.find((item) => Number(item.sleep_hours ?? 0) > 0 && Number(item.sleep_hours ?? 0) <= 5);
  if (poorSleep) {
    pushItem(
      patientContext,
      `Patient-reported poor sleep (${String(poorSleep.sleep_hours)} hours) with symptoms: ${String(poorSleep.symptoms ?? 'noted symptom burden')}.`,
      'medium',
      findCitationId(input.citationSources, [`lifestyle-${String(poorSleep.id ?? '')}`]),
      'patient_reported',
    );
  }

  const onHoldMedication = input.currentMedications.find((item) => String(item.status ?? '').toLowerCase() === 'on_hold');
  if (onHoldMedication) {
    pushItem(
      medicationFocus,
      `${String(onHoldMedication.medication_name ?? 'Medication')} is on hold and needs review${onHoldMedication.status_reason ? `: ${String(onHoldMedication.status_reason)}` : ''}.`,
      'high',
      findCitationId(input.citationSources, ['medication-']),
      'clinician_entered',
    );
  }

  const stoppedMedication = input.stoppedMedications[0];
  if (stoppedMedication) {
    pushItem(
      medicationFocus,
      `Recently stopped medication noted: ${String(stoppedMedication.medication_name ?? stoppedMedication.generic_name ?? 'medication')}.`,
      'medium',
      findCitationId(input.citationSources, ['medication-']),
      'clinician_entered',
    );
  }

  if (!input.hasScheduledFollowUp && (activeIssues.length > 0 || bloodSugar >= 200 || systolic >= 140)) {
    pushItem(
      followUpRisks,
      'No follow-up is scheduled despite unstable current issues.',
      'critical',
      findCitationId(input.citationSources, ['consultation-', 'appt-']),
      'clinician_entered',
    );
  }

  if (input.hasUnverifiedAllergy) {
    pushItem(
      cautions,
      'Unverified allergy data remains in the chart and should be confirmed before medication changes.',
      'medium',
      findCitationId(input.citationSources, ['allergy-']),
      'mixed',
    );
  }

  const pendingPatientSignal = [...input.adverseReactions, ...input.lifestyleLogs]
    .find((item) => normalizeReviewStatus(item.review_status) === 'pending_review');
  if (pendingPatientSignal) {
    pushItem(
      cautions,
      'Important patient-reported context is still pending clinical review.',
      'medium',
      findCitationId(input.citationSources, ['adr-', 'lifestyle-']),
      'patient_reported',
    );
    pushItem(
      provenanceFlags,
      'Some patient-reported items remain pending review and should not be treated as verified clinical truth.',
      'medium',
      findCitationId(input.citationSources, ['adr-', 'lifestyle-']),
      'patient_reported',
    );
  }

  const severeAllergy = input.allergies.find((item) => ['severe', 'life_threatening'].includes(String(item.severity ?? '').toLowerCase()));
  if (severeAllergy) {
    pushItem(
      activeIssues,
      `Severe allergy on record: ${String(severeAllergy.allergen ?? 'allergen')} (${String(severeAllergy.severity ?? 'severe')}).`,
      'high',
      findCitationId(input.citationSources, ['allergy-']),
      'clinician_verified',
    );
  }

  const familyRisk = input.familyRiskOverview?.insights?.[0];
  if (familyRisk) {
    pushItem(
      familyHistory,
      `${familyRisk.label}: ${familyRisk.care_context ?? familyRisk.rationale} Use this as screening context, not as a diagnosis.`,
      familyRisk.severity === 'elevated' ? 'high' : 'medium',
      findCitationId(input.citationSources, ['family-risk-']),
      'mixed',
    );
    if (familyRisk.screening_prompts?.[0]) {
      pushItem(
        followUpRisks,
        `Family-history screening prompt: ${familyRisk.screening_prompts[0]}`,
        familyRisk.screening_priority === 'high_attention' ? 'high' : 'medium',
        findCitationId(input.citationSources, ['family-risk-']),
        'mixed',
      );
    }
  }

  const unstableProblem = input.activeProblems[0];
  const oneLiner = activeIssues[0]
    ? `${topText(activeIssues)} ${unstableProblem ? `Active condition: ${String(unstableProblem.description ?? 'ongoing chronic disease')}.` : ''}`.trim()
    : unstableProblem
      ? `Active condition on chart: ${String(unstableProblem.description ?? 'ongoing issue')}.`
      : 'No major active issues highlighted.';

  return {
    oneLiner,
    activeIssues: sortItems(activeIssues),
    familyHistory: sortItems(familyHistory),
    patientContext: sortItems(patientContext),
    recentChanges: sortItems(recentChanges),
    medicationFocus: sortItems(medicationFocus),
    abnormalFindings: sortItems(abnormalFindings),
    followUpRisks: sortItems(followUpRisks),
    cautions: sortItems(cautions),
    provenanceFlags: sortItems(provenanceFlags),
  };
}

export function sanitizeAiSummaryOutput(
  input: Record<string, unknown>,
  allowedCitationIds: Set<string>,
  fallback: PhysicianSummary,
): PhysicianSummary {
  const keys: PhysicianSummaryListKey[] = [
    'activeIssues',
    'familyHistory',
    'patientContext',
    'recentChanges',
    'medicationFocus',
    'abnormalFindings',
    'followUpRisks',
    'cautions',
    'provenanceFlags',
  ];

  const output: PhysicianSummary = {
    ...fallback,
    oneLiner: typeof input.oneLiner === 'string' && input.oneLiner.trim() ? input.oneLiner : fallback.oneLiner,
  };

  for (const key of keys) {
    const raw = input[key];
    if (!Array.isArray(raw) || raw.length === 0) {
      output[key] = fallback[key];
      continue;
    }

    const sanitized = raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => {
        const citations = Array.isArray(item.citationIds)
          ? item.citationIds.filter((value): value is string => typeof value === 'string' && allowedCitationIds.has(value))
          : [];

        if (citations.length === 0) return null;

        const priority = String(item.priority ?? 'medium');
        const provenance = String(item.provenance ?? 'clinician_entered');
        return {
          text: String(item.text ?? '').trim(),
          priority: (['critical', 'high', 'medium', 'info'].includes(priority) ? priority : 'medium') as SummaryPriority,
          citationIds: citations,
          provenance: (['clinician_verified', 'clinician_entered', 'patient_reported', 'mixed'].includes(provenance) ? provenance : 'clinician_entered') as SummaryProvenance,
        };
      })
      .filter((item): item is PhysicianSummaryItem => Boolean(item?.text));

    output[key] = sanitized.length > 0 ? sanitized : fallback[key];
  }

  return output;
}

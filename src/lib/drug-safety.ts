// ═══════════════════════════════════════════════════════════════════════════════
// Drug-Condition Contraindication Rules
// ═══════════════════════════════════════════════════════════════════════════════

interface DrugConditionRule {
  id: string;
  drugMatchers: string[];
  conditionMatchers: string[];   // matched against patient diagnoses/problem list
  severity: 'contraindicated' | 'major' | 'moderate';
  title: string;
  description: string;
  recommendation: string;
}

const DRUG_CONDITION_RULES: DrugConditionRule[] = [
  {
    id: 'nsaid-heart-failure',
    drugMatchers: ['ibuprofen', 'naproxen', 'diclofenac', 'ketorolac', 'indomethacin', 'piroxicam', 'meloxicam', 'celecoxib'],
    conditionMatchers: ['heart failure', 'congestive heart failure', 'chf', 'hf', 'i50'],
    severity: 'major',
    title: 'NSAID in Heart Failure',
    description: 'NSAIDs cause fluid retention and can worsen heart failure. Risk of acute decompensation.',
    recommendation: 'Use paracetamol for pain. If NSAID is essential, use lowest dose for shortest duration with close monitoring.',
  },
  {
    id: 'acei-pregnancy',
    drugMatchers: ['enalapril', 'lisinopril', 'ramipril', 'captopril', 'perindopril', 'benazepril', 'fosinopril', 'quinapril', 'trandolapril'],
    conditionMatchers: ['pregnancy', 'pregnant', 'o00-o99', 'z33'],
    severity: 'contraindicated',
    title: 'ACE Inhibitor in Pregnancy',
    description: 'ACE inhibitors are teratogenic, especially in 2nd/3rd trimester. Risk of renal dysgenesis, oligohydramnios, fetal death.',
    recommendation: 'Switch to labetalol, nifedipine, or methyldopa for pregnancy hypertension.',
  },
  {
    id: 'arb-pregnancy',
    drugMatchers: ['losartan', 'valsartan', 'telmisartan', 'irbesartan', 'olmesartan', 'candesartan', 'azilsartan'],
    conditionMatchers: ['pregnancy', 'pregnant', 'o00-o99', 'z33'],
    severity: 'contraindicated',
    title: 'ARB in Pregnancy',
    description: 'Angiotensin receptor blockers carry same fetal risks as ACE inhibitors.',
    recommendation: 'Switch to labetalol, nifedipine, or methyldopa.',
  },
  {
    id: 'metformin-renal',
    drugMatchers: ['metformin'],
    conditionMatchers: ['renal failure', 'chronic kidney disease', 'ckd', 'ckd stage 4', 'ckd stage 5', 'n18.4', 'n18.5', 'esrd', 'dialysis'],
    severity: 'contraindicated',
    title: 'Metformin in Severe Renal Impairment',
    description: 'Metformin is contraindicated when eGFR <30. Risk of lactic acidosis.',
    recommendation: 'Use insulin or GLP-1 agonist. If eGFR 30-45, reduce dose to 500mg BD max.',
  },
  {
    id: 'nsaid-ckd',
    drugMatchers: ['ibuprofen', 'naproxen', 'diclofenac', 'ketorolac', 'indomethacin', 'piroxicam', 'meloxicam'],
    conditionMatchers: ['chronic kidney disease', 'ckd', 'renal failure', 'renal impairment', 'n18'],
    severity: 'major',
    title: 'NSAID in Chronic Kidney Disease',
    description: 'NSAIDs reduce renal blood flow and can accelerate CKD progression.',
    recommendation: 'Avoid NSAIDs. Use paracetamol for pain management.',
  },
  {
    id: 'warfarin-liver-disease',
    drugMatchers: ['warfarin'],
    conditionMatchers: ['liver disease', 'hepatic failure', 'cirrhosis', 'liver cirrhosis', 'k74', 'k70', 'k71'],
    severity: 'major',
    title: 'Warfarin in Liver Disease',
    description: 'Liver disease impairs clotting factor synthesis, increasing bleeding risk with warfarin.',
    recommendation: 'Use with extreme caution. Start at lower dose, monitor INR frequently.',
  },
  {
    id: 'beta-blocker-asthma',
    drugMatchers: ['propranolol', 'atenolol', 'metoprolol', 'nadolol', 'timolol', 'carvedilol'],
    conditionMatchers: ['asthma', 'bronchial asthma', 'j45', 'copd', 'j44'],
    severity: 'major',
    title: 'Beta-Blocker in Asthma/COPD',
    description: 'Non-selective beta-blockers can cause bronchospasm in asthma and COPD patients.',
    recommendation: 'Use cardioselective beta-blocker (bisoprolol) at lowest dose if needed, or consider alternative antihypertensive.',
  },
  {
    id: 'statin-pregnancy',
    drugMatchers: ['atorvastatin', 'rosuvastatin', 'simvastatin', 'pravastatin', 'lovastatin', 'fluvastatin'],
    conditionMatchers: ['pregnancy', 'pregnant', 'z33'],
    severity: 'contraindicated',
    title: 'Statin in Pregnancy',
    description: 'Statins are category X — may cause fetal skeletal malformations.',
    recommendation: 'Discontinue statin during pregnancy. Resume postpartum if needed.',
  },
  {
    id: 'methotrexate-pregnancy',
    drugMatchers: ['methotrexate'],
    conditionMatchers: ['pregnancy', 'pregnant', 'z33'],
    severity: 'contraindicated',
    title: 'Methotrexate in Pregnancy',
    description: 'Methotrexate is a known teratogen and abortifacient.',
    recommendation: 'Absolutely contraindicated. Ensure reliable contraception during and 3 months after treatment.',
  },
  {
    id: 'nsaid-peptic-ulcer',
    drugMatchers: ['ibuprofen', 'naproxen', 'diclofenac', 'ketorolac', 'indomethacin', 'aspirin', 'piroxicam'],
    conditionMatchers: ['peptic ulcer', 'gastric ulcer', 'duodenal ulcer', 'gi bleeding', 'k25', 'k26', 'k27', 'k92.0'],
    severity: 'major',
    title: 'NSAID with Peptic Ulcer/GI Bleeding History',
    description: 'NSAIDs increase GI bleeding risk 4-6x in patients with ulcer history.',
    recommendation: 'Use paracetamol. If NSAID unavoidable, co-prescribe PPI (omeprazole 20mg).',
  },
  {
    id: 'potassium-sparing-ckd',
    drugMatchers: ['spironolactone', 'eplerenone', 'amiloride', 'triamterene'],
    conditionMatchers: ['chronic kidney disease', 'ckd', 'renal failure', 'hyperkalemia', 'n18', 'e87.5'],
    severity: 'major',
    title: 'Potassium-Sparing Diuretic in CKD/Hyperkalemia',
    description: 'Risk of life-threatening hyperkalemia in renal impairment.',
    recommendation: 'Monitor potassium closely. Consider alternative. Contraindicated if K+ >5.5 or eGFR <30.',
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Patient-Adjusted Dosing Rules
// ═══════════════════════════════════════════════════════════════════════════════

export interface PatientContext {
  age_years?: number;
  weight_kg?: number;
  sex?: 'M' | 'F';
  is_pregnant?: boolean;
  is_breastfeeding?: boolean;
  egfr?: number;           // estimated GFR in mL/min/1.73m²
  child_pugh_score?: string; // 'A', 'B', 'C'
  diagnoses?: string[];     // active problem list / ICD codes
}

interface DoseAdjustmentRule {
  id: string;
  drugMatchers: string[];
  check: (ctx: PatientContext, dose_mg: number, freq: number) => DoseAdjustmentResult | null;
}

interface DoseAdjustmentResult {
  type: 'renal_adjustment' | 'hepatic_adjustment' | 'pediatric_adjustment' | 'geriatric_adjustment' | 'weight_based' | 'pregnancy_caution';
  severity: MedicationSafetyFinding['severity'];
  blocking: boolean;
  title: string;
  description: string;
  recommendation: string;
}

const DOSE_ADJUSTMENT_RULES: DoseAdjustmentRule[] = [
  {
    id: 'renal-general',
    drugMatchers: ['metformin', 'gabapentin', 'pregabalin', 'digoxin', 'allopurinol', 'ranitidine', 'acyclovir', 'vancomycin', 'gentamicin', 'amikacin'],
    check: (ctx, dose_mg) => {
      if (!ctx.egfr || ctx.egfr >= 60) return null;
      if (ctx.egfr >= 30) {
        return {
          type: 'renal_adjustment', severity: 'warning', blocking: false,
          title: 'Renal Dose Adjustment Required',
          description: `Patient eGFR is ${ctx.egfr} mL/min (moderate impairment). This drug requires dose reduction.`,
          recommendation: 'Reduce dose by 25-50% or extend interval. Consult renal dosing guidelines.',
        };
      }
      return {
        type: 'renal_adjustment', severity: 'critical', blocking: true,
        title: 'Severe Renal Impairment — Dose Review Required',
        description: `Patient eGFR is ${ctx.egfr} mL/min (severe impairment). Standard dosing may cause toxicity.`,
        recommendation: 'Reduce dose by 50-75%, extend interval, or use alternative drug. Nephrology consult recommended.',
      };
    },
  },
  {
    id: 'hepatic-general',
    drugMatchers: ['paracetamol', 'acetaminophen', 'methotrexate', 'amiodarone', 'valproic acid', 'carbamazepine', 'phenytoin', 'isoniazid', 'rifampicin'],
    check: (ctx, dose_mg) => {
      if (!ctx.child_pugh_score) return null;
      if (ctx.child_pugh_score === 'A') return null; // mild — usually no adjustment
      const severe = ctx.child_pugh_score === 'C';
      return {
        type: 'hepatic_adjustment',
        severity: severe ? 'critical' : 'warning',
        blocking: severe,
        title: `Hepatic Impairment (Child-Pugh ${ctx.child_pugh_score})`,
        description: `Patient has ${severe ? 'severe' : 'moderate'} hepatic impairment. Drug metabolism may be significantly reduced.`,
        recommendation: severe
          ? 'Avoid if possible. If essential, reduce dose by 50-75% and monitor LFTs weekly.'
          : 'Consider 25-50% dose reduction. Monitor LFTs regularly.',
      };
    },
  },
  {
    id: 'pediatric-weight-check',
    drugMatchers: [], // applies to all drugs
    check: (ctx, dose_mg, freq) => {
      if (!ctx.age_years || ctx.age_years >= 12 || !ctx.weight_kg) return null;
      const dailyDose = dose_mg * freq;
      const mgPerKg = dailyDose / ctx.weight_kg;
      if (mgPerKg > 100) { // very rough sanity check
        return {
          type: 'pediatric_adjustment', severity: 'critical', blocking: true,
          title: 'Pediatric Dose May Be Excessive',
          description: `Calculated dose is ${mgPerKg.toFixed(1)} mg/kg/day for a ${ctx.weight_kg}kg child. Verify age-appropriate dosing.`,
          recommendation: 'Use pediatric dosing calculator. Most drugs: 10-50 mg/kg/day for children.',
        };
      }
      return null;
    },
  },
  {
    id: 'geriatric-caution',
    drugMatchers: ['diazepam', 'lorazepam', 'alprazolam', 'zolpidem', 'amitriptyline', 'nortriptyline', 'chlorpheniramine', 'diphenhydramine', 'oxybutynin', 'digoxin'],
    check: (ctx) => {
      if (!ctx.age_years || ctx.age_years < 65) return null;
      return {
        type: 'geriatric_adjustment', severity: 'warning', blocking: false,
        title: 'Beers Criteria: High-Risk Medication in Elderly',
        description: `Patient is ${ctx.age_years} years old. This medication is on the Beers List of potentially inappropriate drugs for elderly patients.`,
        recommendation: 'Start at lowest dose. Consider safer alternative. Review Beers Criteria.',
      };
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// Original Drug Safety Code Below
// ═══════════════════════════════════════════════════════════════════════════════

const PENICILLIN_FAMILY = [
  'penicillin',
  'amoxicillin',
  'ampicillin',
  'cloxacillin',
  'dicloxacillin',
  'flucloxacillin',
  'piperacillin',
];

const CROSS_REACTIVE_GROUPS = [PENICILLIN_FAMILY];

export interface DrugAllergyRecord {
  allergen: string;
  severity: string;
}

export interface MedicationSafetyCandidate {
  medication_name: string;
  generic_name?: string | null;
  dose_mg?: number;
  frequency_per_day?: number;
}

export interface ActiveMedicationRecord {
  medication_name: string;
  generic_name?: string | null;
  status?: string | null;
}

export interface RecentlyStoppedMedicationRecord extends ActiveMedicationRecord {
  stop_date?: string | null;
}

export interface DrugInteractionPairRecord {
  drug_a_name: string;
  drug_b_name: string;
  severity: string;
  description: string;
  recommendation?: string | null;
}

export interface FormularyDrugRecord {
  name: string;
  generic_name?: string | null;
  max_daily_dose_mg?: number | null;
}

export interface MedicationSafetyFinding {
  type: 'drug_interaction' | 'washout_interaction' | 'allergy_contraindication' | 'duplicate_therapy' | 'max_dose' | 'drug_condition' | 'dose_adjustment';
  severity: 'info' | 'warning' | 'critical' | 'contraindicated';
  blocking: boolean;
  title: string;
  description: string;
  recommendation?: string;
  subject_medication: string;
  related_medication?: string;
  interaction_pair?: string;
}

export interface MedicationSafetyEvaluation {
  safe: boolean;
  has_blocking: boolean;
  has_contraindicated: boolean;
  has_major: boolean;
  warning_count: number;
  findings: MedicationSafetyFinding[];
}

interface WashoutRule {
  id: string;
  recentlyStoppedMatchers: string[];
  newMedicationMatchers: string[];
  washoutDays: number;
  severity: 'contraindicated' | 'major';
  title: string;
  description: string;
  recommendation: string;
}

const IRREVERSIBLE_MAOI_MATCHERS = [
  'phenelzine',
  'tranylcypromine',
  'isocarboxazid',
  'selegiline',
  'rasagiline',
];

const SEROTONERGIC_MATCHERS = [
  'sertraline',
  'fluoxetine',
  'paroxetine',
  'citalopram',
  'escitalopram',
  'fluvoxamine',
  'venlafaxine',
  'desvenlafaxine',
  'duloxetine',
  'tramadol',
  'meperidine',
  'dextromethorphan',
];

const MAOI_LIKE_NEW_MEDICATION_MATCHERS = [
  ...IRREVERSIBLE_MAOI_MATCHERS,
  'linezolid',
  'methylene blue',
];

const WASHOUT_RULES: WashoutRule[] = [
  {
    id: 'recent-maoi-before-serotonergic',
    recentlyStoppedMatchers: IRREVERSIBLE_MAOI_MATCHERS,
    newMedicationMatchers: SEROTONERGIC_MATCHERS,
    washoutDays: 14,
    severity: 'contraindicated',
    title: 'Washout Risk: recent MAOI exposure',
    description: 'A recently discontinued MAOI-family medication may still create serotonin-toxicity risk during the washout period.',
    recommendation: 'Respect a 14-day washout period after stopping an MAOI-family medication before starting serotonergic therapy.',
  },
  {
    id: 'recent-fluoxetine-before-maoi-like-agent',
    recentlyStoppedMatchers: ['fluoxetine'],
    newMedicationMatchers: MAOI_LIKE_NEW_MEDICATION_MATCHERS,
    washoutDays: 35,
    severity: 'contraindicated',
    title: 'Washout Risk: recent fluoxetine exposure',
    description: 'Fluoxetine has a long residual effect and can remain interaction-relevant after discontinuation.',
    recommendation: 'Respect a 35-day washout period after stopping fluoxetine before starting an MAOI-like medication.',
  },
];

export function normalizeMedicationName(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b\d+(mg|mcg|g|ml)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(allergen: string, medicine: string): boolean {
  if (!allergen || !medicine) return false;
  if (medicine.includes(allergen) || allergen.includes(medicine)) return true;

  return CROSS_REACTIVE_GROUPS.some((group) =>
    group.includes(allergen) && group.includes(medicine),
  );
}

export function buildInteractionPairKey(a: string, b: string): string {
  return [normalizeMedicationName(a), normalizeMedicationName(b)]
    .filter(Boolean)
    .sort()
    .join('::');
}

function severityToFindingSeverity(severity: string): MedicationSafetyFinding['severity'] {
  const normalized = String(severity ?? '').toLowerCase();
  if (normalized === 'contraindicated') return 'contraindicated';
  if (normalized === 'major') return 'critical';
  if (normalized === 'moderate') return 'warning';
  return 'info';
}

function isBlockingInteractionSeverity(severity: string): boolean {
  return ['contraindicated', 'major'].includes(String(severity ?? '').toLowerCase());
}

export function hasBlockingSeverity(severity: string): boolean {
  return ['life_threatening', 'severe'].includes((severity ?? '').toLowerCase());
}

function toMedicationKey(item: { medication_name: string; generic_name?: string | null }): string {
  return normalizeMedicationName(item.generic_name ?? item.medication_name);
}

function uniquePairId(left: string, right: string): string {
  return [left, right].sort().join('::');
}

function parseIsoDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysSince(date: Date, now = new Date()): number {
  return (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000);
}

function remainingWashoutDays(date: Date, washoutDays: number, now = new Date()): number {
  return Math.max(0, Math.ceil(washoutDays - daysSince(date, now)));
}

function matchesAny(normalizedName: string, matchers: string[]): boolean {
  return matchers.some((matcher) => normalizedName === matcher || normalizedName.includes(matcher) || matcher.includes(normalizedName));
}

export function findDrugAllergyConflicts(
  prescribedNames: string[],
  allergies: DrugAllergyRecord[],
): string[] {
  const normalizedMeds = prescribedNames.map(normalizeMedicationName).filter(Boolean);

  const conflicts: string[] = [];
  for (const allergy of allergies) {
    const normalizedAllergen = normalizeMedicationName(allergy.allergen ?? '');
    if (!normalizedAllergen) continue;

    for (const med of normalizedMeds) {
      if (namesMatch(normalizedAllergen, med)) {
        conflicts.push(
          `ALLERGY CONTRAINDICATION: "${med}" may conflict with documented allergy to "${allergy.allergen}" (severity: ${allergy.severity})`,
        );
      }
    }
  }

  return conflicts;
}

export function evaluateMedicationSafety(input: {
  newItems: MedicationSafetyCandidate[];
  activeMedications: ActiveMedicationRecord[];
  recentlyStoppedMedications?: RecentlyStoppedMedicationRecord[];
  allergies: DrugAllergyRecord[];
  interactionPairs: DrugInteractionPairRecord[];
  formularyByDrug: Record<string, FormularyDrugRecord>;
  patientContext?: PatientContext;
}): MedicationSafetyEvaluation {
  const findings: MedicationSafetyFinding[] = [];
  const seen = new Set<string>();
  const now = new Date();

  const activeMedications = (input.activeMedications ?? []).filter((item) => (item.status ?? 'active') === 'active');
  const recentlyStoppedMedications = (input.recentlyStoppedMedications ?? [])
    .filter((item) => ['discontinued', 'completed', 'on_hold', 'suspended'].includes(String(item.status ?? '').toLowerCase()));
  const normalizedPairs = new Map<string, DrugInteractionPairRecord>();
  for (const pair of input.interactionPairs ?? []) {
    const key = buildInteractionPairKey(pair.drug_a_name, pair.drug_b_name);
    if (key) normalizedPairs.set(key, pair);
  }

  const activeByKey = new Map<string, ActiveMedicationRecord[]>();
  for (const med of activeMedications) {
    const key = toMedicationKey(med);
    if (!key) continue;
    activeByKey.set(key, [...(activeByKey.get(key) ?? []), med]);
  }

  const newItems = input.newItems ?? [];

  for (let index = 0; index < newItems.length; index += 1) {
    const item = newItems[index];
    const subjectKey = toMedicationKey(item);
    if (!subjectKey) continue;

    for (const stoppedMedication of recentlyStoppedMedications) {
      const stoppedKey = toMedicationKey(stoppedMedication);
      const stoppedAt = parseIsoDate(stoppedMedication.stop_date);
      if (!stoppedKey || !stoppedAt) continue;

      for (const rule of WASHOUT_RULES) {
        if (!matchesAny(stoppedKey, rule.recentlyStoppedMatchers)) continue;
        if (!matchesAny(subjectKey, rule.newMedicationMatchers)) continue;

        const elapsedDays = daysSince(stoppedAt, now);
        if (elapsedDays > rule.washoutDays) continue;

        const uniqueId = `washout:${rule.id}:${index}:${uniquePairId(subjectKey, stoppedKey)}`;
        if (seen.has(uniqueId)) continue;
        seen.add(uniqueId);

        const remainingDays = remainingWashoutDays(stoppedAt, rule.washoutDays, now);

        findings.push({
          type: 'washout_interaction',
          severity: severityToFindingSeverity(rule.severity),
          blocking: isBlockingInteractionSeverity(rule.severity),
          title: `${rule.title}: ${item.medication_name} ↔ ${stoppedMedication.medication_name}`,
          description: `${rule.description} ${stoppedMedication.medication_name} was stopped recently and ${remainingDays} washout day${remainingDays === 1 ? '' : 's'} remain.`,
          recommendation: rule.recommendation,
          subject_medication: item.medication_name,
          related_medication: stoppedMedication.medication_name,
          interaction_pair: `${rule.id}::${buildInteractionPairKey(subjectKey, stoppedKey)}`,
        });
      }
    }

    for (const [activeKey, activeItems] of activeByKey.entries()) {
      const pair = normalizedPairs.get(buildInteractionPairKey(subjectKey, activeKey));
      if (!pair) continue;

      const uniqueId = `active:${index}:${uniquePairId(subjectKey, activeKey)}`;
      if (seen.has(uniqueId)) continue;
      seen.add(uniqueId);

      findings.push({
        type: 'drug_interaction',
        severity: severityToFindingSeverity(pair.severity),
        blocking: isBlockingInteractionSeverity(pair.severity),
        title: `Drug Interaction: ${item.medication_name} ↔ ${activeItems[0]?.medication_name ?? activeKey}`,
        description: pair.description,
        recommendation: pair.recommendation ?? undefined,
        subject_medication: item.medication_name,
        related_medication: activeItems[0]?.medication_name ?? activeKey,
        interaction_pair: buildInteractionPairKey(pair.drug_a_name, pair.drug_b_name),
      });
    }

    for (let otherIndex = index + 1; otherIndex < newItems.length; otherIndex += 1) {
      const other = newItems[otherIndex];
      const otherKey = toMedicationKey(other);
      if (!otherKey) continue;

      const pair = normalizedPairs.get(buildInteractionPairKey(subjectKey, otherKey));
      if (pair) {
        const uniqueId = `new:${uniquePairId(subjectKey, otherKey)}`;
        if (!seen.has(uniqueId)) {
          seen.add(uniqueId);
          findings.push({
            type: 'drug_interaction',
            severity: severityToFindingSeverity(pair.severity),
            blocking: isBlockingInteractionSeverity(pair.severity),
            title: `Drug Interaction: ${item.medication_name} ↔ ${other.medication_name}`,
            description: pair.description,
            recommendation: pair.recommendation ?? undefined,
            subject_medication: item.medication_name,
            related_medication: other.medication_name,
            interaction_pair: buildInteractionPairKey(pair.drug_a_name, pair.drug_b_name),
          });
        }
      }

      if (subjectKey === otherKey) {
        const uniqueId = `same-order-dup:${uniquePairId(subjectKey, otherKey)}:${index}:${otherIndex}`;
        if (!seen.has(uniqueId)) {
          seen.add(uniqueId);
          findings.push({
            type: 'duplicate_therapy',
            severity: 'warning',
            blocking: false,
            title: `Duplicate Therapy: ${item.medication_name}`,
            description: `The same medication appears more than once in this prescription order (${item.medication_name} and ${other.medication_name}).`,
            recommendation: 'Remove the duplicate order or document why both entries are needed.',
            subject_medication: item.medication_name,
            related_medication: other.medication_name,
          });
        }
      }
    }

    const matchingActive = activeByKey.get(subjectKey) ?? [];
    for (const match of matchingActive) {
      const uniqueId = `active-dup:${index}:${subjectKey}:${match.medication_name}`;
      if (seen.has(uniqueId)) continue;
      seen.add(uniqueId);
      findings.push({
        type: 'duplicate_therapy',
        severity: 'warning',
        blocking: false,
        title: `Duplicate Therapy: ${item.medication_name}`,
        description: `Patient already has active medication "${match.medication_name}" for the same normalized drug.`,
        recommendation: 'Verify that the current active medication should continue before adding another order.',
        subject_medication: item.medication_name,
        related_medication: match.medication_name,
      });
    }

    for (const allergy of input.allergies ?? []) {
      const normalizedAllergen = normalizeMedicationName(allergy.allergen ?? '');
      if (!normalizedAllergen || !namesMatch(normalizedAllergen, subjectKey)) continue;

      const severity = hasBlockingSeverity(allergy.severity) ? 'contraindicated'
        : String(allergy.severity ?? '').toLowerCase() === 'moderate' ? 'critical'
          : 'warning';
      const uniqueId = `allergy:${index}:${normalizedAllergen}`;
      if (seen.has(uniqueId)) continue;
      seen.add(uniqueId);

      findings.push({
        type: 'allergy_contraindication',
        severity,
        blocking: severity === 'contraindicated',
        title: `Allergy Alert: ${item.medication_name}`,
        description: `Patient has documented ${allergy.severity} drug allergy to "${allergy.allergen}".`,
        recommendation: 'Use an alternative medication or document clinical justification.',
        subject_medication: item.medication_name,
        related_medication: allergy.allergen,
      });
    }

    const formularyEntry = input.formularyByDrug[subjectKey];
    if (formularyEntry?.max_daily_dose_mg && item.dose_mg && item.frequency_per_day) {
      const dailyDose = item.dose_mg * item.frequency_per_day;
      if (dailyDose > formularyEntry.max_daily_dose_mg) {
        const severity: MedicationSafetyFinding['severity'] = dailyDose >= (formularyEntry.max_daily_dose_mg * 1.5)
          ? 'critical'
          : 'warning';

        findings.push({
          type: 'max_dose',
          severity,
          blocking: severity === 'critical',
          title: `Max Dose Exceeded: ${item.medication_name}`,
          description: `Requested daily dose ${dailyDose}mg/day exceeds the configured maximum ${formularyEntry.max_daily_dose_mg}mg/day.`,
          recommendation: 'Reduce the dose or document the clinical rationale for the higher dose.',
          subject_medication: item.medication_name,
        });
      }
    }

    // ── Drug-Condition Contraindication Checks ───────────────────────────────
    const patientDiagnoses = (input.patientContext?.diagnoses ?? []).map(d => d.toLowerCase());
    if (patientDiagnoses.length > 0) {
      for (const rule of DRUG_CONDITION_RULES) {
        if (!matchesAny(subjectKey, rule.drugMatchers)) continue;
        const conditionMatch = rule.conditionMatchers.find(cm =>
          patientDiagnoses.some(pd => pd.includes(cm) || cm.includes(pd)),
        );
        if (!conditionMatch) continue;

        const uniqueId = `condition:${rule.id}:${index}`;
        if (seen.has(uniqueId)) continue;
        seen.add(uniqueId);

        findings.push({
          type: 'drug_condition',
          severity: severityToFindingSeverity(rule.severity),
          blocking: isBlockingInteractionSeverity(rule.severity),
          title: `${rule.title}: ${item.medication_name}`,
          description: rule.description,
          recommendation: rule.recommendation,
          subject_medication: item.medication_name,
          related_medication: conditionMatch,
        });
      }
    }

    // Also check pregnancy from patientContext flag
    if (input.patientContext?.is_pregnant) {
      for (const rule of DRUG_CONDITION_RULES) {
        if (!rule.conditionMatchers.includes('pregnancy')) continue;
        if (!matchesAny(subjectKey, rule.drugMatchers)) continue;
        const uniqueId = `condition-preg:${rule.id}:${index}`;
        if (seen.has(uniqueId)) continue;
        seen.add(uniqueId);
        findings.push({
          type: 'drug_condition',
          severity: severityToFindingSeverity(rule.severity),
          blocking: isBlockingInteractionSeverity(rule.severity),
          title: `${rule.title}: ${item.medication_name}`,
          description: rule.description,
          recommendation: rule.recommendation,
          subject_medication: item.medication_name,
        });
      }
    }

    // ── Patient-Adjusted Dosing Checks ───────────────────────────────────────
    if (input.patientContext) {
      const ctx = input.patientContext;
      const doseMg = item.dose_mg ?? 0;
      const freq = item.frequency_per_day ?? 1;

      for (const rule of DOSE_ADJUSTMENT_RULES) {
        if (rule.drugMatchers.length > 0 && !matchesAny(subjectKey, rule.drugMatchers)) continue;
        const result = rule.check(ctx, doseMg, freq);
        if (!result) continue;

        const uniqueId = `dose-adj:${rule.id}:${index}`;
        if (seen.has(uniqueId)) continue;
        seen.add(uniqueId);

        findings.push({
          type: 'dose_adjustment',
          severity: result.severity,
          blocking: result.blocking,
          title: `${result.title}: ${item.medication_name}`,
          description: result.description,
          recommendation: result.recommendation,
          subject_medication: item.medication_name,
        });
      }
    }
  }

  const severityRank: Record<MedicationSafetyFinding['severity'], number> = {
    contraindicated: 0,
    critical: 1,
    warning: 2,
    info: 3,
  };

  findings.sort((left, right) => {
    const severityDiff = severityRank[left.severity] - severityRank[right.severity];
    if (severityDiff !== 0) return severityDiff;
    return left.title.localeCompare(right.title);
  });

  return {
    safe: findings.length === 0,
    has_blocking: findings.some((item) => item.blocking),
    has_contraindicated: findings.some((item) => item.severity === 'contraindicated'),
    has_major: findings.some((item) => item.type === 'drug_interaction' && item.blocking),
    warning_count: findings.length,
    findings,
  };
}

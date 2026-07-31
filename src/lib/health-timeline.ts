/**
 * Cross-Hospital Health Timeline Aggregator
 *
 * Merges clinical data from multiple hospitals into a single
 * chronological timeline for the patient's global health view.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { buildPortableHealthSummary, type PortableHealthSummary } from './health-summary';
import { autoGrantTreatmentConsent } from './consent-rules';

export interface TimelineEvent {
  date: string;
  type: 'diagnosis' | 'medication' | 'lab_result' | 'vitals' | 'vaccination' | 'discharge' | 'allergy';
  hospital: string;
  description: string;
  details: Record<string, unknown>;
}

type TimelineProvenance = {
  source: string;
  verified: boolean;
  review_status: 'pending_review' | 'verified' | 'rejected';
  badge: 'Pending Review' | 'Doctor Verified' | 'Rejected';
};

export interface AggregatedHealthRecord {
  uhid: string | null;
  hospitals: Array<{
    name: string;
    tenant_id: number;
    linked_at: string;
    has_consent: boolean;
  }>;
  timeline: TimelineEvent[];
  combined_allergies: Array<{
    allergen: string;
    severity: string | null;
    source_hospital: string;
  }>;
  combined_medications: Array<{
    medication_name: string;
    generic_name: string | null;
    dosage: string | null;
    frequency: string | null;
    status: string;
    source_hospital: string;
  }>;
  combined_problems: Array<{
    description: string;
    icd10_code: string | null;
    severity: string | null;
    status: string;
    source_hospital: string;
  }>;
}

/**
 * Build a unified health timeline from all consented hospitals.
 */
export async function buildAggregatedHealthRecord(
  db: D1Database,
  identityKey: string,
  requestingTenantId: string | number,
  requestingUserId?: number,
  role?: string,
  clinicalAreas?: string[],
): Promise<AggregatedHealthRecord> {
  // 1. Get all linked hospitals
  const { results: links } = await db.prepare(`
    SELECT phl.tenant_id, phl.patient_id, phl.hospital_name, phl.linked_at, phl.uhid
    FROM patient_health_links phl
    WHERE phl.is_active = 1
      AND (phl.national_id = ? OR phl.uhid = ?)
    ORDER BY phl.linked_at DESC
  `).bind(identityKey, identityKey).all<{
    tenant_id: number;
    patient_id: number;
    hospital_name: string | null;
    linked_at: string;
    uhid: string | null;
  }>();

  if (!links || links.length === 0) {
    return {
      uhid: null,
      hospitals: [],
      timeline: [],
      combined_allergies: [],
      combined_medications: [],
      combined_problems: [],
    };
  }

  const uhid = links[0]?.uhid ?? null;
  const hospitals: AggregatedHealthRecord['hospitals'] = [];
  const timeline: TimelineEvent[] = [];
  const combinedAllergies: AggregatedHealthRecord['combined_allergies'] = [];
  const combinedMedications: AggregatedHealthRecord['combined_medications'] = [];
  const combinedProblems: AggregatedHealthRecord['combined_problems'] = [];

  // Track seen items for deduplication
  const seenAllergens = new Set<string>();
  const seenMedications = new Set<string>();
  const seenProblems = new Set<string>();

  // 2. Batch-fetch ALL active consents for this NID in one query (Fix N+1)
  const { results: allConsents } = await db.prepare(`
    SELECT granting_tenant_id, granted_to_tenant_id, consent_type, clinical_areas
    FROM health_record_consents
    WHERE national_id = ? AND is_active = 1
      AND expires_at > datetime('now')
      AND consent_type IN ('view_summary', 'view_full', 'emergency_access')
  `).bind(identityKey).all<{
    granting_tenant_id: number;
    granted_to_tenant_id: number | null;
    consent_type: string;
    clinical_areas: string | null;
  }>();

  // Check if there is an active Break-Glass override for this user
  let hasBreakGlass = false;
  if (role !== 'patient' && requestingUserId) {
    const override = await db.prepare(`
      SELECT id FROM health_record_consent_overrides
      WHERE national_id = ? AND accessing_tenant_id = ? AND accessing_user_id = ?
        AND created_at > datetime('now', '-2 hours')
    `).bind(identityKey, requestingTenantId, requestingUserId).first();
    if (override) hasBreakGlass = true;
  }

  // Build a map of consented tenant IDs -> { includeSensitive, areas }
  const consentedTenants = new Map<number, { full: boolean; areas: string[] }>();
  for (const consent of (allConsents ?? [])) {
    if (consent.granted_to_tenant_id === null || consent.granted_to_tenant_id === Number(requestingTenantId)) {
      const isFull = consent.consent_type === 'view_full' || consent.consent_type === 'emergency_access';
      // Parse clinical_areas: NULL means all, JSON array means specific areas
      let consentAreas: string[] = ['all'];
      if (consent.clinical_areas) {
        try { consentAreas = JSON.parse(consent.clinical_areas); } catch { /* corrupt data → default all */ }
      }
      const existing = consentedTenants.get(consent.granting_tenant_id);
      if (!existing) {
        consentedTenants.set(consent.granting_tenant_id, { full: isFull, areas: consentAreas });
      } else {
        // UNION areas: merge from multiple consents (most permissive wins)
        if (isFull) existing.full = true;
        if (existing.areas.includes('all') || consentAreas.includes('all')) {
          existing.areas = ['all'];
        } else {
          const merged = new Set([...existing.areas, ...consentAreas]);
          existing.areas = [...merged];
        }
      }
    }
  }

  // 2b. Treatment-purpose access: if requesting staff has an active (undischarged)
  //     visit with the patient at a linked hospital, auto-grant via consent-rules
  if (role !== 'patient' && requestingUserId) {
    const unconsented = links.filter(l => !consentedTenants.has(l.tenant_id));
    if (unconsented.length > 0) {
      const visitChecks = await Promise.all(
        unconsented.map(link =>
          db.prepare(`
            SELECT id FROM visits
            WHERE patient_id = ? AND doctor_id = ? AND tenant_id = ?
              AND discharge_date IS NULL
            ORDER BY created_at DESC LIMIT 1
          `).bind(link.patient_id, requestingUserId, link.tenant_id).first()
            .then(row => ({ link, hasActive: !!row }))
        ),
      );

      for (const { link, hasActive } of visitChecks) {
        if (hasActive) {
          // Create auditable consent record via consent-rules engine
          await autoGrantTreatmentConsent(
            db, identityKey, link.tenant_id, link.patient_id, requestingUserId,
          ).catch(() => {});
          consentedTenants.set(link.tenant_id, { full: false, areas: ['all'] });
        }
      }
    }
  }

  // Resolve effective clinical areas: intersection of consent areas and requested areas
  function isAreaAllowed(area: string, tenantId: number): boolean {
    const consentInfo = consentedTenants.get(tenantId);
    if (!consentInfo) return false;
    const consentAllows = consentInfo.areas.includes('all') || consentInfo.areas.includes(area);
    const requestAllows = !clinicalAreas || clinicalAreas.includes('all') || clinicalAreas.includes(area);
    return consentAllows && requestAllows;
  }

  // 3. Build summaries — one query per consented hospital (unavoidable),
  //    but consent check is now O(1) instead of a DB query per hospital
  for (const link of links) {
    const hospitalName = link.hospital_name ?? 'Unknown Hospital';
    const hasConsent = hasBreakGlass || consentedTenants.has(link.tenant_id);
    const includeSensitive = hasBreakGlass || consentedTenants.get(link.tenant_id)?.full === true;

    hospitals.push({
      name: hospitalName,
      tenant_id: link.tenant_id,
      linked_at: link.linked_at,
      has_consent: hasConsent,
    });

    if (!hasConsent) continue;

    // Build summary for this hospital
    const summary = await buildPortableHealthSummary(db, link.tenant_id, link.patient_id, includeSensitive);
    if (!summary) continue;

    // Merge allergies (dedup by allergen name, case-insensitive)
    if (hasBreakGlass || isAreaAllowed('allergies', link.tenant_id)) {
      for (const allergy of summary.allergies) {
        const key = allergy.allergen.toLowerCase();
        if (!seenAllergens.has(key)) {
          seenAllergens.add(key);
          combinedAllergies.push({
            allergen: allergy.allergen,
            severity: allergy.severity,
            source_hospital: hospitalName,
          });
        }
      }
    }

    // Merge medications (dedup by generic name or medication name)
    if (hasBreakGlass || isAreaAllowed('prescriptions', link.tenant_id)) {
      for (const med of summary.current_medications) {
        const key = (med.generic_name ?? med.medication_name).toLowerCase();
        if (!seenMedications.has(key)) {
          seenMedications.add(key);
          combinedMedications.push({
            medication_name: med.medication_name,
            generic_name: med.generic_name,
            dosage: med.dosage,
            frequency: med.frequency,
            status: med.status,
            source_hospital: hospitalName,
          });
        }
      }
    }

    // Merge problems (dedup by ICD10 code or description)
    if (hasBreakGlass || isAreaAllowed('diagnoses', link.tenant_id)) {
      for (const problem of summary.active_problems) {
        const key = (problem.icd10_code ?? problem.description).toLowerCase();
        if (!seenProblems.has(key)) {
          seenProblems.add(key);
          combinedProblems.push({
            description: problem.description,
            icd10_code: problem.icd10_code,
            severity: problem.severity,
            status: problem.status,
            source_hospital: hospitalName,
          });
        }
      }
    }

    // Build timeline events from this hospital's data (filtered by areas)
    addToTimeline(timeline, summary, hospitalName, hasBreakGlass ? undefined : clinicalAreas, link.tenant_id, isAreaAllowed);
  }

  // Sort timeline by date descending
  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    uhid,
    hospitals,
    timeline: timeline.slice(0, 100), // Cap at 100 events
    combined_allergies: combinedAllergies,
    combined_medications: combinedMedications,
    combined_problems: combinedProblems,
  };
}

/**
 * Extract timeline events from a PortableHealthSummary.
 */
function addToTimeline(
  timeline: TimelineEvent[],
  summary: PortableHealthSummary,
  hospitalName: string,
  _clinicalAreas?: string[],
  tenantId?: number,
  isAreaAllowed?: (area: string, tenantId: number) => boolean,
): void {
  const canShow = (area: string) => !isAreaAllowed || !tenantId || isAreaAllowed(area, tenantId);
  const toTimelineProvenance = (
    provenance?: {
      source: string;
      verified: boolean;
      review_status: 'pending_review' | 'verified' | 'rejected';
    },
    fallbackSource: string = 'hospital',
  ): TimelineProvenance => {
    const reviewStatus = provenance?.review_status ?? 'verified';
    return {
      source: provenance?.source ?? fallbackSource,
      verified: provenance?.verified ?? reviewStatus === 'verified',
      review_status: reviewStatus,
      badge: reviewStatus === 'verified'
        ? 'Doctor Verified'
        : reviewStatus === 'rejected'
          ? 'Rejected'
          : 'Pending Review',
    };
  };

  // Diagnoses → timeline
  if (canShow('diagnoses')) {
    for (const d of summary.recent_diagnoses) {
      if (d.created_at) {
        timeline.push({
          date: d.created_at,
          type: 'diagnosis',
          hospital: hospitalName,
          description: d.description ?? d.icd10_code ?? 'Diagnosis',
          details: {
            icd10_code: d.icd10_code,
            diagnosis_type: d.diagnosis_type,
            provenance: toTimelineProvenance(d.provenance),
          },
        });
      }
    }
  }

  // Lab results → timeline
  if (canShow('labs')) {
    for (const l of summary.recent_lab_results) {
      if (l.completed_at) {
        timeline.push({
          date: l.completed_at,
          type: 'lab_result',
          hospital: hospitalName,
          description: l.test_name ?? 'Lab Test',
          details: {
            result: l.result,
            abnormal_flag: l.abnormal_flag,
            unit: l.unit,
            normal_range: l.normal_range,
            provenance: toTimelineProvenance(undefined),
          },
        });
      }
    }
  }

  // Vaccinations → timeline (always visible — safety-exception)
  for (const v of summary.vaccinations) {
    if (v.administered_date) {
      timeline.push({
        date: v.administered_date,
        type: 'vaccination',
        hospital: hospitalName,
        description: `${v.vaccine_name} (Dose ${v.dose_number})`,
        details: {
          dose_number: v.dose_number,
          total_doses: v.total_doses,
          status: v.status,
          provenance: toTimelineProvenance(undefined),
        },
      });
    }
  }

  // Last vitals → single timeline event
  if (canShow('vitals') && summary.last_vitals?.recorded_at) {
    timeline.push({
      date: summary.last_vitals.recorded_at,
      type: 'vitals',
      hospital: hospitalName,
      description: 'Vitals Recorded',
      details: {
        ...summary.last_vitals,
        provenance: toTimelineProvenance(summary.last_vitals.provenance),
      },
    });
  }

  // Discharge → timeline
  if (canShow('visits') && summary.last_discharge?.updated_at) {
    timeline.push({
      date: summary.last_discharge.updated_at,
      type: 'discharge',
      hospital: hospitalName,
      description: summary.last_discharge.final_diagnosis ?? 'Discharge Summary',
      details: {
        ...summary.last_discharge,
        provenance: toTimelineProvenance(undefined),
      },
    });
  }
}

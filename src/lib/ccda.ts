/**
 * CCDA (Consolidated Clinical Document Architecture) Export
 *
 * Generates CDA R2.1 / C-CDA 2.1 compliant XML documents.
 * Supports: CCD (Continuity of Care Document) type.
 *
 * Sections implemented:
 *   1. Patient Demographics (recordTarget)
 *   2. Allergies (48765-2)
 *   3. Medications (10160-0)
 *   4. Vital Signs (8716-3)
 *   5. Problems/Diagnoses (11450-4)
 *   6. Results/Labs (30954-2)
 *   7. Procedures (47519-4)
 *
 * Reference: HL7 C-CDA 2.1 Implementation Guide
 */

// ─── Types ───────────────────────────────────────────────────────

export interface CCDAPatient {
  id: number;
  name: string;
  gender: string;
  date_of_birth: string | null;
  phone: string | null;
  address: string | null;
  nid: string | null;
  blood_group: string | null;
}

export interface CCDAAllergy {
  allergen: string;
  reaction_type: string | null;
  severity: string | null;
  onset_date: string | null;
}

export interface CCDAMedication {
  medication_name: string;
  dose: string | null;
  frequency: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
}

export interface CCDAVital {
  type: string;
  value: number | string;
  unit: string | null;
  recorded_at: string;
}

export interface CCDAProblem {
  diagnosis: string;
  icd_code: string | null;
  status: string | null;
  onset_date: string | null;
}

export interface CCDALabResult {
  test_name: string;
  value: string | null;
  unit: string | null;
  reference_range: string | null;
  result_date: string | null;
  status: string | null;
}

export interface CCDAProcedure {
  name: string;
  date: string | null;
  status: string | null;
  notes: string | null;
}

export interface CCDADocument {
  patient: CCDAPatient;
  allergies: CCDAAllergy[];
  medications: CCDAMedication[];
  vitals: CCDAVital[];
  problems: CCDAProblem[];
  labResults: CCDALabResult[];
  procedures: CCDAProcedure[];
  author: { name: string; organization: string };
  generatedAt: string;
}

// ─── LOINC Section Codes ─────────────────────────────────────────

export const CCDA_SECTION_CODES = {
  allergies:   { code: '48765-2', title: 'Allergies and Adverse Reactions' },
  medications: { code: '10160-0', title: 'Medications' },
  vitals:      { code: '8716-3',  title: 'Vital Signs' },
  problems:    { code: '11450-4', title: 'Problem List' },
  results:     { code: '30954-2', title: 'Results' },
  procedures:  { code: '47519-4', title: 'Procedures' },
} as const;

// ─── XML Helpers ─────────────────────────────────────────────────

export function escapeXml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDate(date: string | null): string {
  if (!date) return '';
  // Convert to YYYYMMDD format for CDA
  return date.replace(/[-:T.Z]/g, '').slice(0, 14);
}

function genderCode(gender: string | null): string {
  if (!gender) return 'UN';
  const g = gender.toLowerCase();
  if (g === 'male' || g === 'm') return 'M';
  if (g === 'female' || g === 'f') return 'F';
  return 'UN';
}

// ─── Builder ─────────────────────────────────────────────────────

export function buildCCDADocument(doc: CCDADocument): string {
  const now = formatDate(doc.generatedAt) || formatDate(new Date().toISOString());

  return `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="urn:hl7-org:v3 CDA.xsd">
  <realmCode code="BD"/>
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.2" extension="2015-08-01"/>
  <id root="2.16.840.1.113883.19" extension="${doc.patient.id}-${now}"/>
  <code code="34133-9" codeSystem="2.16.840.1.113883.6.1" displayName="Summarization of Episode Note"/>
  <title>Continuity of Care Document — ${escapeXml(doc.patient.name)}</title>
  <effectiveTime value="${now}"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <languageCode code="en-US"/>
  ${buildRecordTarget(doc.patient)}
  ${buildAuthor(doc.author, now)}
  ${buildCustodian(doc.author)}
  <component>
    <structuredBody>
      ${buildAllergySection(doc.allergies)}
      ${buildMedicationSection(doc.medications)}
      ${buildVitalSignsSection(doc.vitals)}
      ${buildProblemSection(doc.problems)}
      ${buildResultsSection(doc.labResults)}
      ${buildProcedureSection(doc.procedures)}
    </structuredBody>
  </component>
</ClinicalDocument>`;
}

function buildRecordTarget(p: CCDAPatient): string {
  const names = (p.name || 'Unknown').split(' ');
  const given = escapeXml(names[0]);
  const family = escapeXml(names.slice(1).join(' ') || names[0]);

  return `<recordTarget>
    <patientRole>
      ${p.nid ? `<id root="2.16.840.1.113883.2.18.1" extension="${escapeXml(p.nid)}"/>` : '<id nullFlavor="UNK"/>'}
      ${p.phone ? `<telecom value="tel:${escapeXml(p.phone)}"/>` : ''}
      ${p.address ? `<addr><streetAddressLine>${escapeXml(p.address)}</streetAddressLine><country>BD</country></addr>` : ''}
      <patient>
        <name><given>${given}</given><family>${family}</family></name>
        <administrativeGenderCode code="${genderCode(p.gender)}" codeSystem="2.16.840.1.113883.5.1"/>
        ${p.date_of_birth ? `<birthTime value="${formatDate(p.date_of_birth)}"/>` : ''}
      </patient>
    </patientRole>
  </recordTarget>`;
}

function buildAuthor(author: { name: string; organization: string }, time: string): string {
  return `<author>
    <time value="${time}"/>
    <assignedAuthor>
      <id nullFlavor="UNK"/>
      <assignedPerson><name>${escapeXml(author.name)}</name></assignedPerson>
      <representedOrganization><name>${escapeXml(author.organization)}</name></representedOrganization>
    </assignedAuthor>
  </author>`;
}

function buildCustodian(author: { organization: string }): string {
  return `<custodian>
    <assignedCustodian>
      <representedCustodianOrganization>
        <name>${escapeXml(author.organization)}</name>
      </representedCustodianOrganization>
    </assignedCustodian>
  </custodian>`;
}

function buildAllergySection(allergies: CCDAAllergy[]): string {
  const s = CCDA_SECTION_CODES.allergies;
  if (allergies.length === 0) return buildEmptySection(s, 'No known allergies');

  const rows = allergies.map((a) =>
    `<tr><td>${escapeXml(a.allergen)}</td><td>${escapeXml(a.reaction_type)}</td><td>${escapeXml(a.severity)}</td><td>${escapeXml(a.onset_date)}</td></tr>`
  ).join('\n');

  return `<component>
    <section>
      <templateId root="2.16.840.1.113883.10.20.22.2.6.1"/>
      <code code="${s.code}" codeSystem="2.16.840.1.113883.6.1" displayName="${s.title}"/>
      <title>${s.title}</title>
      <text>
        <table><thead><tr><th>Allergen</th><th>Type</th><th>Severity</th><th>Onset</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </text>
    </section>
  </component>`;
}

function buildMedicationSection(meds: CCDAMedication[]): string {
  const s = CCDA_SECTION_CODES.medications;
  if (meds.length === 0) return buildEmptySection(s, 'No medications on record');

  const rows = meds.map((m) =>
    `<tr><td>${escapeXml(m.medication_name)}</td><td>${escapeXml(m.dose)}</td><td>${escapeXml(m.frequency)}</td><td>${escapeXml(m.status)}</td></tr>`
  ).join('\n');

  return `<component>
    <section>
      <templateId root="2.16.840.1.113883.10.20.22.2.1.1"/>
      <code code="${s.code}" codeSystem="2.16.840.1.113883.6.1" displayName="${s.title}"/>
      <title>${s.title}</title>
      <text>
        <table><thead><tr><th>Medication</th><th>Dose</th><th>Frequency</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </text>
    </section>
  </component>`;
}

function buildVitalSignsSection(vitals: CCDAVital[]): string {
  const s = CCDA_SECTION_CODES.vitals;
  if (vitals.length === 0) return buildEmptySection(s, 'No vital signs recorded');

  const rows = vitals.map((v) =>
    `<tr><td>${escapeXml(String(v.type))}</td><td>${escapeXml(String(v.value))} ${escapeXml(v.unit)}</td><td>${escapeXml(v.recorded_at)}</td></tr>`
  ).join('\n');

  return `<component>
    <section>
      <templateId root="2.16.840.1.113883.10.20.22.2.4.1"/>
      <code code="${s.code}" codeSystem="2.16.840.1.113883.6.1" displayName="${s.title}"/>
      <title>${s.title}</title>
      <text>
        <table><thead><tr><th>Vital</th><th>Value</th><th>Date</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </text>
    </section>
  </component>`;
}

function buildProblemSection(problems: CCDAProblem[]): string {
  const s = CCDA_SECTION_CODES.problems;
  if (problems.length === 0) return buildEmptySection(s, 'No active problems');

  const rows = problems.map((p) =>
    `<tr><td>${escapeXml(p.diagnosis)}</td><td>${escapeXml(p.icd_code)}</td><td>${escapeXml(p.status)}</td><td>${escapeXml(p.onset_date)}</td></tr>`
  ).join('\n');

  return `<component>
    <section>
      <templateId root="2.16.840.1.113883.10.20.22.2.5.1"/>
      <code code="${s.code}" codeSystem="2.16.840.1.113883.6.1" displayName="${s.title}"/>
      <title>${s.title}</title>
      <text>
        <table><thead><tr><th>Problem</th><th>ICD Code</th><th>Status</th><th>Onset</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </text>
    </section>
  </component>`;
}

function buildResultsSection(results: CCDALabResult[]): string {
  const s = CCDA_SECTION_CODES.results;
  if (results.length === 0) return buildEmptySection(s, 'No lab results on record');

  const rows = results.map((r) =>
    `<tr><td>${escapeXml(r.test_name)}</td><td>${escapeXml(r.value)} ${escapeXml(r.unit)}</td><td>${escapeXml(r.reference_range)}</td><td>${escapeXml(r.result_date)}</td></tr>`
  ).join('\n');

  return `<component>
    <section>
      <templateId root="2.16.840.1.113883.10.20.22.2.3.1"/>
      <code code="${s.code}" codeSystem="2.16.840.1.113883.6.1" displayName="${s.title}"/>
      <title>${s.title}</title>
      <text>
        <table><thead><tr><th>Test</th><th>Value</th><th>Reference</th><th>Date</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </text>
    </section>
  </component>`;
}

function buildProcedureSection(procedures: CCDAProcedure[]): string {
  const s = CCDA_SECTION_CODES.procedures;
  if (procedures.length === 0) return buildEmptySection(s, 'No procedures on record');

  const rows = procedures.map((p) =>
    `<tr><td>${escapeXml(p.name)}</td><td>${escapeXml(p.date)}</td><td>${escapeXml(p.status)}</td><td>${escapeXml(p.notes)}</td></tr>`
  ).join('\n');

  return `<component>
    <section>
      <templateId root="2.16.840.1.113883.10.20.22.2.7.1"/>
      <code code="${s.code}" codeSystem="2.16.840.1.113883.6.1" displayName="${s.title}"/>
      <title>${s.title}</title>
      <text>
        <table><thead><tr><th>Procedure</th><th>Date</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </text>
    </section>
  </component>`;
}

function buildEmptySection(s: { code: string; title: string }, msg: string): string {
  return `<component>
    <section>
      <code code="${s.code}" codeSystem="2.16.840.1.113883.6.1" displayName="${s.title}"/>
      <title>${s.title}</title>
      <text>${msg}</text>
    </section>
  </component>`;
}

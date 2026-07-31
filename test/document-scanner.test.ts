import { describe, it, expect } from 'vitest';
import { classifyDocument } from '../src/lib/document-classifier';

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 — Task 3: Document Scanner (TDD)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 3.1 classifyDocument — Pure function tests ────────────────────────────

describe('classifyDocument', () => {
  // --- Prescription detection ---
  it('detects prescription from Rx + medication keywords', () => {
    const text = 'Rx\nTab Paracetamol 500mg\nDose: 1 Tab twice daily after meal\nCap Omeprazole 20mg OD before meal';
    expect(classifyDocument(text)).toBe('prescription');
  });

  it('detects prescription from Bangla keywords', () => {
    const text = 'প্রেসক্রিপশন\nবড়ি প্যারাসিটামল ৫০০ mg\nসিরাপ অ্যামক্সিসিলিন';
    expect(classifyDocument(text)).toBe('prescription');
  });

  it('detects prescription with TDS/BD abbreviations', () => {
    const text = 'Prescribed by Dr. Khan\nTab Metformin 500mg BD\nTab Amlodipine 5mg OD';
    expect(classifyDocument(text)).toBe('prescription');
  });

  // --- Lab report detection ---
  it('detects lab report from CBC keywords', () => {
    const text = 'Lab Report\nCBC Test Result\nHemoglobin: 14.5 g/dL\nWBC: 7500\nRBC: 5.2\nPlatelet: 250000\nReference Range: Normal';
    expect(classifyDocument(text)).toBe('lab_report');
  });

  it('detects lab report from blood sugar/HbA1c keywords', () => {
    const text = 'Pathology Report\nFasting Blood Sugar: 110 mg/dL\nHbA1c: 6.5%\nCholesterol: 180 mg/dL';
    expect(classifyDocument(text)).toBe('lab_report');
  });

  it('detects lab report from liver function test keywords', () => {
    const text = 'Laboratory\nSGPT: 25 U/L\nSGOT: 30 U/L\nBilirubin: 0.8 mg/dL\nAlbumin: 4.0 g/dL\nSpecimen: Blood';
    expect(classifyDocument(text)).toBe('lab_report');
  });

  it('detects lab report from Bangla keywords', () => {
    const text = 'রক্ত পরীক্ষা\nল্যাব রিপোর্ট\nHemoglobin: 12.5';
    expect(classifyDocument(text)).toBe('lab_report');
  });

  // --- Discharge summary detection ---
  it('detects discharge summary from admission/discharge keywords', () => {
    const text = 'Discharge Summary\nAdmission Date: 2025-01-01\nDischarge Date: 2025-01-05\nPatient was admitted with pneumonia\nWard: General\nCondition at discharge: Stable\nFollow up in 2 weeks';
    expect(classifyDocument(text)).toBe('discharge_summary');
  });

  it('detects discharge summary from hospital stay keywords', () => {
    const text = 'Hospital Stay Report\nDiagnosis on discharge: Dengue Fever\nAdvised: Rest and hydration\nFollow-up after 1 week';
    expect(classifyDocument(text)).toBe('discharge_summary');
  });

  it('detects discharge summary from Bangla keywords', () => {
    const text = 'ছাড়পত্র\nরোগী ভর্তি হয়েছিলেন 01/01/2025\nহাসপাতাল থেকে ছাড়া হয়েছে';
    expect(classifyDocument(text)).toBe('discharge_summary');
  });

  // --- 'other' fallback ---
  it('returns "other" for unrelated text', () => {
    const text = 'This is a random document about cooking recipes and gardening tips.';
    expect(classifyDocument(text)).toBe('other');
  });

  it('returns "other" for text with only one keyword (below threshold)', () => {
    const text = 'I bought some medicine from the pharmacy.';
    // Only 1 keyword match — below threshold of 2
    expect(classifyDocument(text)).toBe('other');
  });

  // --- Edge cases ---
  it('handles empty string', () => {
    expect(classifyDocument('')).toBe('other');
  });

  it('handles null', () => {
    expect(classifyDocument(null)).toBe('other');
  });

  it('handles undefined', () => {
    expect(classifyDocument(undefined)).toBe('other');
  });

  it('handles whitespace-only string', () => {
    expect(classifyDocument('   \n\t  ')).toBe('other');
  });

  // --- Priority/scoring ---
  it('picks the type with the highest keyword score when mixed', () => {
    // This text has more lab keywords than prescription keywords
    const text = 'Lab Report: CBC, Hemoglobin 14g/dL, WBC 7500, RBC 5.2, Platelet 250k, Creatinine 1.0, Reference Range. Tab Paracetamol prescribed.';
    expect(classifyDocument(text)).toBe('lab_report');
  });

  it('handles case insensitivity', () => {
    const text = 'RX\nTAB METFORMIN 500MG\nDOSE: TWICE DAILY AFTER MEAL';
    expect(classifyDocument(text)).toBe('prescription');
  });
});

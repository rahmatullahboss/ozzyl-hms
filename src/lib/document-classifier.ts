/**
 * Document Classifier
 *
 * Pure function that classifies OCR text from medical documents
 * using keyword scoring. No external API dependency — fully testable.
 */

export type DocumentType = 'prescription' | 'lab_report' | 'discharge_summary' | 'other';

interface KeywordGroup {
  type: DocumentType;
  keywords: string[];
  /** Minimum score (number of keyword matches) to classify as this type */
  threshold: number;
}

const KEYWORD_GROUPS: KeywordGroup[] = [
  {
    type: 'prescription',
    keywords: [
      'rx', 'tab', 'cap', 'syrup', 'dose', 'mg', 'ml',
      'twice daily', 'thrice daily', 'once daily',
      'after meal', 'before meal', 'tds', 'bd', 'od',
      'prescribed', 'prescription', 'pharmacy',
      'ওষুধ', 'বড়ি', 'সিরাপ', 'প্রেসক্রিপশন',
    ],
    threshold: 2,
  },
  {
    type: 'lab_report',
    keywords: [
      'cbc', 'hba1c', 'cholesterol', 'creatinine', 'hemoglobin',
      'wbc', 'rbc', 'platelet', 'blood sugar', 'fasting',
      'urine', 'sgpt', 'sgot', 'bilirubin', 'albumin',
      'test result', 'lab report', 'reference range', 'normal range',
      'specimen', 'pathology', 'laboratory',
      'রক্ত পরীক্ষা', 'ল্যাব রিপোর্ট',
    ],
    threshold: 2,
  },
  {
    type: 'discharge_summary',
    keywords: [
      'discharge', 'admitted', 'hospital stay', 'discharge summary',
      'diagnosis on discharge', 'condition at discharge',
      'admission date', 'discharge date', 'ward',
      'follow up', 'follow-up', 'advised',
      'ছাড়পত্র', 'ভর্তি', 'হাসপাতাল',
    ],
    threshold: 2,
  },
];

/**
 * Classify a document from its OCR text content using keyword scoring.
 *
 * @param ocrText - The raw OCR text extracted from the document
 * @returns The detected document type, or 'other' if no match
 */
export function classifyDocument(ocrText: string | null | undefined): DocumentType {
  if (!ocrText || typeof ocrText !== 'string' || ocrText.trim().length === 0) {
    return 'other';
  }

  const lower = ocrText.toLowerCase();

  let bestType: DocumentType = 'other';
  let bestScore = 0;

  for (const group of KEYWORD_GROUPS) {
    let score = 0;
    for (const keyword of group.keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        score++;
      }
    }
    if (score >= group.threshold && score > bestScore) {
      bestScore = score;
      bestType = group.type;
    }
  }

  return bestType;
}

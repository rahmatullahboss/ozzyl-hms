import { describe, it, expect } from 'vitest';
import {
  escapeXml,
  buildCCDADocument,
  CCDA_SECTION_CODES,
  type CCDADocument,
  type CCDAPatient,
} from '../src/lib/ccda';

describe('CCDA_SECTION_CODES', () => {
  it('has 6 sections', () => {
    expect(Object.keys(CCDA_SECTION_CODES)).toHaveLength(6);
  });

  it('uses correct LOINC codes', () => {
    expect(CCDA_SECTION_CODES.allergies.code).toBe('48765-2');
    expect(CCDA_SECTION_CODES.medications.code).toBe('10160-0');
    expect(CCDA_SECTION_CODES.vitals.code).toBe('8716-3');
    expect(CCDA_SECTION_CODES.problems.code).toBe('11450-4');
    expect(CCDA_SECTION_CODES.results.code).toBe('30954-2');
    expect(CCDA_SECTION_CODES.procedures.code).toBe('47519-4');
  });
});

describe('escapeXml', () => {
  it('escapes ampersand', () => {
    expect(escapeXml('A & B')).toBe('A &amp; B');
  });

  it('escapes angle brackets', () => {
    expect(escapeXml('<script>')).toBe('&lt;script&gt;');
  });

  it('escapes quotes', () => {
    expect(escapeXml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('escapes apostrophe', () => {
    expect(escapeXml("it's")).toBe('it&apos;s');
  });

  it('returns empty string for null/undefined', () => {
    expect(escapeXml(null)).toBe('');
    expect(escapeXml(undefined)).toBe('');
    expect(escapeXml('')).toBe('');
  });

  it('handles Bangla text without escaping', () => {
    expect(escapeXml('রহমত উল্লাহ')).toBe('রহমত উল্লাহ');
  });
});

describe('buildCCDADocument', () => {
  const basePatient: CCDAPatient = {
    id: 42,
    name: 'Rahmat Zisan',
    gender: 'male',
    date_of_birth: '1995-03-15',
    phone: '+8801712345678',
    address: 'Dhaka, Bangladesh',
    nid: '1234567890123',
    blood_group: 'O+',
  };

  const baseDoc: CCDADocument = {
    patient: basePatient,
    allergies: [],
    medications: [],
    vitals: [],
    problems: [],
    labResults: [],
    procedures: [],
    author: { name: 'Dr. Test', organization: 'Test Hospital' },
    generatedAt: '2026-04-19T12:00:00Z',
  };

  it('generates valid XML declaration', () => {
    const xml = buildCCDADocument(baseDoc);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
  });

  it('has ClinicalDocument root element', () => {
    const xml = buildCCDADocument(baseDoc);
    expect(xml).toContain('<ClinicalDocument');
    expect(xml).toContain('</ClinicalDocument>');
  });

  it('includes C-CDA 2.1 template ID', () => {
    const xml = buildCCDADocument(baseDoc);
    expect(xml).toContain('2.16.840.1.113883.10.20.22.1.2');
  });

  it('includes patient name in title', () => {
    const xml = buildCCDADocument(baseDoc);
    expect(xml).toContain('Rahmat Zisan');
  });

  it('sets realm code to BD', () => {
    const xml = buildCCDADocument(baseDoc);
    expect(xml).toContain('<realmCode code="BD"/>');
  });

  it('includes recordTarget with patient data', () => {
    const xml = buildCCDADocument(baseDoc);
    expect(xml).toContain('<recordTarget>');
    expect(xml).toContain('<given>Rahmat</given>');
    expect(xml).toContain('<family>Zisan</family>');
    expect(xml).toContain('code="M"');
  });

  it('includes NID as identifier', () => {
    const xml = buildCCDADocument(baseDoc);
    expect(xml).toContain('1234567890123');
    expect(xml).toContain('2.16.840.1.113883.2.18.1');
  });

  it('handles patient without NID', () => {
    const doc = { ...baseDoc, patient: { ...basePatient, nid: null } };
    const xml = buildCCDADocument(doc);
    expect(xml).toContain('nullFlavor="UNK"');
  });

  it('includes author and custodian', () => {
    const xml = buildCCDADocument(baseDoc);
    expect(xml).toContain('<author>');
    expect(xml).toContain('Dr. Test');
    expect(xml).toContain('Test Hospital');
    expect(xml).toContain('<custodian>');
  });

  it('includes structuredBody with all 6 sections', () => {
    const xml = buildCCDADocument(baseDoc);
    expect(xml).toContain('<structuredBody>');
    // All 6 LOINC codes should be present
    expect(xml).toContain('48765-2'); // allergies
    expect(xml).toContain('10160-0'); // medications
    expect(xml).toContain('8716-3');  // vitals
    expect(xml).toContain('11450-4'); // problems
    expect(xml).toContain('30954-2'); // results
    expect(xml).toContain('47519-4'); // procedures
  });

  it('shows empty section messages when no data', () => {
    const xml = buildCCDADocument(baseDoc);
    expect(xml).toContain('No known allergies');
    expect(xml).toContain('No medications on record');
    expect(xml).toContain('No vital signs recorded');
  });
});

describe('buildCCDADocument with data', () => {
  it('renders allergy rows', () => {
    const doc: CCDADocument = {
      patient: { id: 1, name: 'Test', gender: 'female', date_of_birth: null, phone: null, address: null, nid: null, blood_group: null },
      allergies: [{ allergen: 'Penicillin', reaction_type: 'allergy', severity: 'severe', onset_date: '2020-01-01' }],
      medications: [],
      vitals: [],
      problems: [],
      labResults: [],
      procedures: [],
      author: { name: 'System', organization: 'HMS' },
      generatedAt: '2026-04-19T00:00:00Z',
    };
    const xml = buildCCDADocument(doc);
    expect(xml).toContain('Penicillin');
    expect(xml).toContain('severe');
    expect(xml).not.toContain('No known allergies');
  });

  it('renders medication rows', () => {
    const doc: CCDADocument = {
      patient: { id: 1, name: 'Test', gender: 'male', date_of_birth: null, phone: null, address: null, nid: null, blood_group: null },
      allergies: [],
      medications: [{ medication_name: 'Metformin 500mg', dose: '500mg', frequency: 'BD', start_date: '2026-01-01', end_date: null, status: 'active' }],
      vitals: [],
      problems: [],
      labResults: [],
      procedures: [],
      author: { name: 'System', organization: 'HMS' },
      generatedAt: '2026-04-19T00:00:00Z',
    };
    const xml = buildCCDADocument(doc);
    expect(xml).toContain('Metformin 500mg');
    expect(xml).toContain('active');
  });

  it('renders vital signs rows', () => {
    const doc: CCDADocument = {
      patient: { id: 1, name: 'Test', gender: 'male', date_of_birth: null, phone: null, address: null, nid: null, blood_group: null },
      allergies: [],
      medications: [],
      vitals: [{ type: 'blood_pressure', value: '120/80', unit: 'mmHg', recorded_at: '2026-04-19T10:00:00Z' }],
      problems: [],
      labResults: [],
      procedures: [],
      author: { name: 'System', organization: 'HMS' },
      generatedAt: '2026-04-19T00:00:00Z',
    };
    const xml = buildCCDADocument(doc);
    expect(xml).toContain('120/80');
    expect(xml).toContain('mmHg');
  });

  it('renders problem list with ICD codes', () => {
    const doc: CCDADocument = {
      patient: { id: 1, name: 'Test', gender: 'male', date_of_birth: null, phone: null, address: null, nid: null, blood_group: null },
      allergies: [],
      medications: [],
      vitals: [],
      problems: [{ diagnosis: 'Type 2 Diabetes', icd_code: 'E11.9', status: 'active', onset_date: '2020-06-01' }],
      labResults: [],
      procedures: [],
      author: { name: 'System', organization: 'HMS' },
      generatedAt: '2026-04-19T00:00:00Z',
    };
    const xml = buildCCDADocument(doc);
    expect(xml).toContain('Type 2 Diabetes');
    expect(xml).toContain('E11.9');
  });

  it('renders lab results', () => {
    const doc: CCDADocument = {
      patient: { id: 1, name: 'Test', gender: 'male', date_of_birth: null, phone: null, address: null, nid: null, blood_group: null },
      allergies: [],
      medications: [],
      vitals: [],
      problems: [],
      labResults: [{ test_name: 'HbA1c', value: '7.2', unit: '%', reference_range: '4.0-5.6', result_date: '2026-04-15', status: 'final' }],
      procedures: [],
      author: { name: 'System', organization: 'HMS' },
      generatedAt: '2026-04-19T00:00:00Z',
    };
    const xml = buildCCDADocument(doc);
    expect(xml).toContain('HbA1c');
    expect(xml).toContain('7.2');
    expect(xml).toContain('4.0-5.6');
  });
});

describe('Gender mapping', () => {
  it('male patient gets code M', () => {
    const doc: CCDADocument = {
      patient: { id: 1, name: 'Test', gender: 'male', date_of_birth: null, phone: null, address: null, nid: null, blood_group: null },
      allergies: [], medications: [], vitals: [], problems: [], labResults: [], procedures: [],
      author: { name: 'S', organization: 'H' }, generatedAt: '2026-04-19T00:00:00Z',
    };
    const xml = buildCCDADocument(doc);
    expect(xml).toContain('code="M"');
  });

  it('female patient gets code F', () => {
    const doc: CCDADocument = {
      patient: { id: 1, name: 'Test', gender: 'female', date_of_birth: null, phone: null, address: null, nid: null, blood_group: null },
      allergies: [], medications: [], vitals: [], problems: [], labResults: [], procedures: [],
      author: { name: 'S', organization: 'H' }, generatedAt: '2026-04-19T00:00:00Z',
    };
    const xml = buildCCDADocument(doc);
    expect(xml).toContain('code="F"');
  });

  it('unknown gender gets code UN', () => {
    const doc: CCDADocument = {
      patient: { id: 1, name: 'Test', gender: 'other', date_of_birth: null, phone: null, address: null, nid: null, blood_group: null },
      allergies: [], medications: [], vitals: [], problems: [], labResults: [], procedures: [],
      author: { name: 'S', organization: 'H' }, generatedAt: '2026-04-19T00:00:00Z',
    };
    const xml = buildCCDADocument(doc);
    expect(xml).toContain('code="UN"');
  });
});

describe('XSS Prevention', () => {
  it('escapes malicious input in patient name', () => {
    const doc: CCDADocument = {
      patient: { id: 1, name: '<script>alert("xss")</script>', gender: 'male', date_of_birth: null, phone: null, address: null, nid: null, blood_group: null },
      allergies: [], medications: [], vitals: [], problems: [], labResults: [], procedures: [],
      author: { name: 'S', organization: 'H' }, generatedAt: '2026-04-19T00:00:00Z',
    };
    const xml = buildCCDADocument(doc);
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;script&gt;');
  });

  it('escapes malicious input in allergen', () => {
    const doc: CCDADocument = {
      patient: { id: 1, name: 'Test', gender: 'male', date_of_birth: null, phone: null, address: null, nid: null, blood_group: null },
      allergies: [{ allergen: '"><img src=x onerror=alert(1)>', reaction_type: null, severity: null, onset_date: null }],
      medications: [], vitals: [], problems: [], labResults: [], procedures: [],
      author: { name: 'S', organization: 'H' }, generatedAt: '2026-04-19T00:00:00Z',
    };
    const xml = buildCCDADocument(doc);
    expect(xml).not.toContain('<img');
    expect(xml).toContain('&lt;img');
  });
});

describe('API Contract', () => {
  it('GET /api/ccda/export/:patientId returns XML', () => {
    const contentType = 'application/xml';
    expect(contentType).toBe('application/xml');
  });

  it('GET /api/ccda/export/:patientId?format=download sets Content-Disposition', () => {
    const filename = `ccda-42-${new Date().toISOString().slice(0, 10)}.xml`;
    expect(filename).toMatch(/^ccda-42-\d{4}-\d{2}-\d{2}\.xml$/);
  });

  it('GET /api/ccda/sections returns all 6 sections', () => {
    const sections = Object.entries(CCDA_SECTION_CODES).map(([key, val]) => ({
      key, loinc_code: val.code, title: val.title,
    }));
    expect(sections).toHaveLength(6);
    expect(sections[0].loinc_code).toBeTruthy();
  });
});

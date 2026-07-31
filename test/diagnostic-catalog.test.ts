import { describe, expect, it } from 'vitest';
import { parseDiagnosticCatalogCsv } from '../src/lib/diagnostic-catalog';

describe('diagnostic catalog CSV parser', () => {
  it('parses lab and radiology catalog rows with quoted fields and row errors', () => {
    const parsed = parseDiagnosticCatalogCsv([
      'kind,code,name,category,price,unit,normal_range,method,active',
      'lab,CBC,"Complete Blood Count",Hematology,500,,,"Automated",1',
      'radiology,XR-CHEST,"Chest X-Ray, PA",X-Ray,800,,,,active',
      'lab,BAD,,Hematology,100,,,,1',
    ].join('\n'));

    expect(parsed.totalRows).toBe(3);
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        kind: 'lab',
        code: 'CBC',
        name: 'Complete Blood Count',
        price: 500,
      }),
      expect.objectContaining({
        kind: 'radiology',
        code: 'XR-CHEST',
        name: 'Chest X-Ray, PA',
        category: 'X-Ray',
        price: 800,
      }),
    ]);
    expect(parsed.errors).toEqual([
      expect.objectContaining({ rowNumber: 4, message: 'Missing name' }),
    ]);
  });

  it('parses hospital price-list CSVs without a code column', () => {
    const parsed = parseDiagnosticCatalogCsv([
      '\uFEFFCategory,Serial_No,Test_Name,Price_BDT',
      'HEMATOLOGY & CLINICAL PATHOLOGY,০১,"TC,DC,ESR,Hb% / (CBC) /CP",500',
      'SEROLOGY & IMMUNOLOGY,০২,ICT For Dengue,600',
      'DIGITAL X-RAY,০১,Chest P/A View,500',
      'ULTRASONOGRAPHY & OTHERS,০২,USG of Whole Abdomen,1000',
    ].join('\n'));

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        kind: 'lab',
        code: 'HCP-01',
        name: 'TC,DC,ESR,Hb% / (CBC) /CP',
        price: 500,
      }),
      expect.objectContaining({
        kind: 'lab',
        code: 'SI-02',
        name: 'ICT For Dengue',
        price: 600,
      }),
      expect.objectContaining({
        kind: 'radiology',
        code: 'XR-01',
        name: 'Chest P/A View',
        price: 500,
      }),
      expect.objectContaining({
        kind: 'radiology',
        code: 'USG-02',
        name: 'USG of Whole Abdomen',
        price: 1000,
      }),
    ]);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const expectedBedTypes = ['general', 'icu', 'nicu', 'hdu', 'cabin', 'vip'];

describe('bed management bed type options', () => {
  it('offers only bed types accepted by the admissions bed API', () => {
    const source = readFileSync('web/src/pages/BedManagement.tsx', 'utf8');

    for (const bedType of expectedBedTypes) {
      expect(source).toContain(`value: '${bedType}'`);
    }

    expect(source).not.toContain('semi_private');
    expect(source).not.toContain('private');
  });

  it('uses readable fallback labels when bed type translations are missing', () => {
    const source = readFileSync('web/src/pages/BedManagement.tsx', 'utf8');

    expect(source).toContain('BED_TYPE_DEFAULT_LABELS');
    expect(source).toContain('defaultValue: BED_TYPE_DEFAULT_LABELS[bed.bed_type]');
    expect(source).toContain('defaultValue: BED_TYPE_DEFAULT_LABELS[detailBed.bed_type]');
  });
});

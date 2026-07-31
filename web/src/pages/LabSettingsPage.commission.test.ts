import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Lab Settings commission eligibility control', () => {
  it('defaults to Yes, hydrates edit state, submits a number, and shows catalog status', () => {
    const source = read('./LabSettingsPage.tsx');

    expect(source).toContain("is_commissionable: '1'");
    expect(source).toContain("is_commissionable: test.is_commissionable === 0 ? '0' : '1'");
    expect(source).toContain('is_commissionable: Number(form.is_commissionable)');
    expect(source).toContain("t('commissionEligible')");
    expect(source).toContain("t('noCommissionBadge')");
    expect(source).toContain("t('commissionEligibleBadge')");
  });

  it('provides clear English and Bangla Yes/No explanations', () => {
    const en = JSON.parse(read('../../public/locales/en/laboratory.json'));
    const bn = JSON.parse(read('../../public/locales/bn/laboratory.json'));

    expect(en.commissionEligibleYes).toMatch(/Yes/i);
    expect(en.commissionEligibleNo).toMatch(/No/i);
    expect(en.commissionEligibleHint).toMatch(/workflow/i);
    expect(bn.commissionEligibleYes).toContain('হ্যাঁ');
    expect(bn.commissionEligibleNo).toContain('না');
    expect(bn.commissionEligibleHint).toContain('ওয়ার্কফ্লো');
  });
});

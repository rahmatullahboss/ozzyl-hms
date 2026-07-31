import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PATIENT_PORTAL_PRIMARY_NAV,
  PATIENT_PORTAL_SECONDARY_NAV,
  PATIENT_PORTAL_BOTTOM_NAV,
  getPatientPortalActiveNavSection,
  getPatientPortalSectionShortcuts,
} from '../apps/ozzyl-lifestyle/src/lib/patientPortalNav';
import {
  getPatientPortalTabFromLocation,
  getPatientPortalPathForTab,
  getPatientPortalPathForBottomNav,
  getPatientPortalDefaultTabForPath,
} from '../apps/ozzyl-lifestyle/src/lib/patientPortalRouting';

function loadLocale(lang: string) {
  const path = resolve(__dirname, `../apps/ozzyl-lifestyle/public/locales/${lang}/patientPortal.json`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  return dotPath.split('.').reduce((acc: unknown, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

describe('patient portal i18n', () => {
  const en = loadLocale('en');
  const bn = loadLocale('bn');

  it('all primary nav items use labelKey instead of hardcoded label', () => {
    for (const item of PATIENT_PORTAL_PRIMARY_NAV) {
      expect(item).toHaveProperty('labelKey');
      expect(typeof item.labelKey).toBe('string');
      expect(item.labelKey.length).toBeGreaterThan(0);
      expect(item).not.toHaveProperty('label');
    }
  });

  it('all secondary nav items use labelKey instead of hardcoded label', () => {
    for (const item of PATIENT_PORTAL_SECONDARY_NAV) {
      expect(item).toHaveProperty('labelKey');
      expect(typeof item.labelKey).toBe('string');
      expect(item.labelKey.length).toBeGreaterThan(0);
      expect(item).not.toHaveProperty('label');
    }
  });

  it('all bottom nav items use labelKey', () => {
    for (const item of PATIENT_PORTAL_BOTTOM_NAV) {
      expect(item).toHaveProperty('labelKey');
      expect(typeof item.labelKey).toBe('string');
      expect(item.labelKey.length).toBeGreaterThan(0);
    }
  });

  it('every primary nav labelKey resolves in EN locale', () => {
    for (const item of PATIENT_PORTAL_PRIMARY_NAV) {
      const value = getNestedValue(en, item.labelKey);
      expect(value, `EN missing key: ${item.labelKey}`).toBeDefined();
      expect(typeof value).toBe('string');
    }
  });

  it('every primary nav labelKey resolves in BN locale', () => {
    for (const item of PATIENT_PORTAL_PRIMARY_NAV) {
      const value = getNestedValue(bn, item.labelKey);
      expect(value, `BN missing key: ${item.labelKey}`).toBeDefined();
      expect(typeof value).toBe('string');
    }
  });

  it('every secondary nav labelKey resolves in both locales', () => {
    for (const item of PATIENT_PORTAL_SECONDARY_NAV) {
      const enVal = getNestedValue(en, item.labelKey);
      const bnVal = getNestedValue(bn, item.labelKey);
      expect(enVal, `EN missing key: ${item.labelKey}`).toBeDefined();
      expect(bnVal, `BN missing key: ${item.labelKey}`).toBeDefined();
    }
  });

  it('every bottom nav labelKey resolves in both locales', () => {
    for (const item of PATIENT_PORTAL_BOTTOM_NAV) {
      const enVal = getNestedValue(en, item.labelKey);
      const bnVal = getNestedValue(bn, item.labelKey);
      expect(enVal, `EN missing key: ${item.labelKey}`).toBeDefined();
      expect(bnVal, `BN missing key: ${item.labelKey}`).toBeDefined();
    }
  });

  it('section intro keys exist in both EN and BN locales', () => {
    const requiredKeys = [
      'sections.care.eyebrow',
      'sections.care.findCareTitle',
      'sections.care.findCareDesc',
      'sections.care.workspaceTitle',
      'sections.care.workspaceDesc',
      'sections.care.tabFindCare',
      'sections.care.tabMyHospitals',
      'sections.records.eyebrow',
      'sections.records.vaultTitle',
      'sections.records.vaultDesc',
      'sections.records.globalTitle',
      'sections.records.globalDesc',
      'sections.records.tabVault',
      'sections.records.tabHealthRecord',
      'sections.wellness.eyebrow',
      'sections.wellness.trendsTitle',
      'sections.wellness.trendsDesc',
      'sections.wellness.tipsTitle',
      'sections.wellness.tipsDesc',
      'sections.wellness.diaryTitle',
      'sections.wellness.diaryDesc',
      'sections.wellness.medsTitle',
      'sections.wellness.medsDesc',
      'sections.wellness.hubTitle',
      'sections.wellness.hubDesc',
      'sections.wellness.tabTrends',
      'sections.wellness.tabTips',
      'sections.wellness.tabJournal',
      'sections.wellness.tabMeds',
      'sections.wellness.tabHub',
      'sections.family.eyebrow',
      'sections.family.title',
      'sections.family.description',
      'sections.profile.eyebrow',
      'sections.profile.dataTitle',
      'sections.profile.dataDesc',
      'sections.profile.privacyTitle',
      'sections.profile.privacyDesc',
      'sections.profile.tabMyData',
      'sections.profile.tabPrivacy',
      'checkinError',
    ];

    for (const key of requiredKeys) {
      const enVal = getNestedValue(en, key);
      const bnVal = getNestedValue(bn, key);
      expect(enVal, `EN missing: ${key}`).toBeDefined();
      expect(typeof enVal, `EN not string: ${key}`).toBe('string');
      expect(bnVal, `BN missing: ${key}`).toBeDefined();
      expect(typeof bnVal, `BN not string: ${key}`).toBe('string');
    }
  });

  it('EN and BN locale files have the same top-level key structure', () => {
    const enKeys = Object.keys(en).sort();
    const bnKeys = Object.keys(bn).sort();
    expect(enKeys).toEqual(bnKeys);
  });

  it('no nav labelKey contains Bangla characters', () => {
    const banglaRange = /[ঀ-৿]/;
    const allItems = [
      ...PATIENT_PORTAL_PRIMARY_NAV,
      ...PATIENT_PORTAL_SECONDARY_NAV,
      ...PATIENT_PORTAL_BOTTOM_NAV,
    ];
    for (const item of allItems) {
      expect(banglaRange.test(item.labelKey), `labelKey contains Bangla: ${item.labelKey}`).toBe(false);
    }
  });
});

describe('patient portal routing', () => {
  it('maps URL paths to correct default tabs', () => {
    expect(getPatientPortalDefaultTabForPath('/patient/home')).toBe('overview');
    expect(getPatientPortalDefaultTabForPath('/patient/care')).toBe('hospital-services');
    expect(getPatientPortalDefaultTabForPath('/patient/records')).toBe('global-records');
    expect(getPatientPortalDefaultTabForPath('/patient/wellness')).toBe('trends');
    expect(getPatientPortalDefaultTabForPath('/patient/family')).toBe('family');
    expect(getPatientPortalDefaultTabForPath('/patient/privacy')).toBe('privacy');
    expect(getPatientPortalDefaultTabForPath('/patient/dashboard')).toBe('overview');
  });

  it('falls back to overview for unknown paths', () => {
    expect(getPatientPortalDefaultTabForPath('/patient/unknown')).toBe('overview');
    expect(getPatientPortalDefaultTabForPath('/random')).toBe('overview');
  });

  it('extracts tab from URL search params', () => {
    expect(getPatientPortalTabFromLocation('/patient/care', '?tab=find-care')).toBe('find-care');
    expect(getPatientPortalTabFromLocation('/patient/records', '?tab=vault')).toBe('vault');
    expect(getPatientPortalTabFromLocation('/patient/wellness', '?tab=medicine-tracker')).toBe('medicine-tracker');
  });

  it('ignores invalid tab params and falls back to path default', () => {
    expect(getPatientPortalTabFromLocation('/patient/care', '?tab=bogus')).toBe('hospital-services');
    expect(getPatientPortalTabFromLocation('/patient/home', '?tab=nonexistent')).toBe('overview');
  });

  it('builds canonical paths for each tab', () => {
    expect(getPatientPortalPathForTab('overview')).toBe('/patient/home');
    expect(getPatientPortalPathForTab('hospital-services')).toBe('/patient/care');
    expect(getPatientPortalPathForTab('find-care')).toBe('/patient/care?tab=find-care');
    expect(getPatientPortalPathForTab('global-records')).toBe('/patient/records');
    expect(getPatientPortalPathForTab('vault')).toBe('/patient/records?tab=vault');
    expect(getPatientPortalPathForTab('trends')).toBe('/patient/wellness');
    expect(getPatientPortalPathForTab('tips')).toBe('/patient/wellness?tab=tips');
    expect(getPatientPortalPathForTab('diary-history')).toBe('/patient/wellness?tab=diary-history');
    expect(getPatientPortalPathForTab('medicine-tracker')).toBe('/patient/wellness?tab=medicine-tracker');
    expect(getPatientPortalPathForTab('wellness')).toBe('/patient/wellness?tab=wellness');
    expect(getPatientPortalPathForTab('family')).toBe('/patient/family');
    expect(getPatientPortalPathForTab('privacy')).toBe('/patient/privacy');
    expect(getPatientPortalPathForTab('data')).toBe('/patient/home?tab=data');
  });

  it('maps bottom nav tabs to correct paths', () => {
    expect(getPatientPortalPathForBottomNav('home')).toBe('/patient/home');
    expect(getPatientPortalPathForBottomNav('care')).toBe('/patient/care');
    expect(getPatientPortalPathForBottomNav('records')).toBe('/patient/records');
    expect(getPatientPortalPathForBottomNav('profile')).toBe('/patient/privacy');
  });
});

describe('patient portal nav sections', () => {
  it('maps every tab id to a valid nav section', () => {
    const allTabIds = [
      'overview', 'find-care', 'hospital-services', 'global-records',
      'vault', 'data', 'privacy', 'trends', 'tips', 'diary-history',
      'medicine-tracker', 'family', 'wellness',
    ] as const;

    const validSections = ['home', 'care', 'records', 'wellness', 'family', 'profile'];

    for (const tabId of allTabIds) {
      const section = getPatientPortalActiveNavSection(tabId);
      expect(validSections, `Tab ${tabId} mapped to invalid section: ${section}`).toContain(section);
    }
  });

  it('returns relevant shortcuts for care section tabs', () => {
    const shortcuts = getPatientPortalSectionShortcuts('hospital-services');
    const ids = shortcuts.map((s) => s.id);
    expect(ids).toContain('hospital-services');
    expect(ids).toContain('find-care');
  });

  it('returns relevant shortcuts for records section tabs', () => {
    const shortcuts = getPatientPortalSectionShortcuts('global-records');
    const ids = shortcuts.map((s) => s.id);
    expect(ids).toContain('global-records');
    expect(ids).toContain('vault');
  });

  it('returns empty shortcuts for wellness section (sub-tabs handled in-section)', () => {
    const shortcuts = getPatientPortalSectionShortcuts('trends');
    expect(shortcuts).toHaveLength(0);
  });

  it('shortcut items have labelKey not label', () => {
    const shortcuts = getPatientPortalSectionShortcuts('hospital-services');
    for (const item of shortcuts) {
      expect(item).toHaveProperty('labelKey');
      expect(item).not.toHaveProperty('label');
    }
  });
});

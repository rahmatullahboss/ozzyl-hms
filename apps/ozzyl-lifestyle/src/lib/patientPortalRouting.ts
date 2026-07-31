import type { BottomNavTabId, PatientDashboardTabId } from './patientPortalNav';

export type PatientPortalTopLevelSection =
  | 'home'
  | 'care'
  | 'records'
  | 'wellness'
  | 'family'
  | 'privacy';

const VALID_TABS = new Set<PatientDashboardTabId>([
  'overview',
  'find-care',
  'hospital-services',
  'global-records',
  'vault',
  'data',
  'privacy',
  'trends',
  'tips',
  'diary-history',
  'medicine-tracker',
  'family',
  'wellness',
]);

const PATH_DEFAULT_TABS: Record<string, PatientDashboardTabId> = {
  '/patient/home': 'overview',
  '/patient/care': 'hospital-services',
  '/patient/records': 'global-records',
  '/patient/wellness': 'trends',
  '/patient/family': 'family',
  '/patient/privacy': 'privacy',
  '/patient/dashboard': 'overview',
};

const TAB_TO_SECTION: Record<PatientDashboardTabId, PatientPortalTopLevelSection> = {
  overview: 'home',
  data: 'home',
  'find-care': 'care',
  'hospital-services': 'care',
  'global-records': 'records',
  vault: 'records',
  trends: 'wellness',
  tips: 'wellness',
  'diary-history': 'wellness',
  'medicine-tracker': 'wellness',
  wellness: 'wellness',
  family: 'family',
  privacy: 'privacy',
};

const SECTION_TO_PATH: Record<PatientPortalTopLevelSection, string> = {
  home: '/patient/home',
  care: '/patient/care',
  records: '/patient/records',
  wellness: '/patient/wellness',
  family: '/patient/family',
  privacy: '/patient/privacy',
};

export function getPatientPortalTopLevelPath(section: PatientPortalTopLevelSection): string {
  return SECTION_TO_PATH[section];
}

export function getPatientPortalTopLevelPathForTab(tab: PatientDashboardTabId): string {
  return SECTION_TO_PATH[TAB_TO_SECTION[tab]];
}

export function getPatientPortalDefaultTabForPath(pathname: string): PatientDashboardTabId {
  return PATH_DEFAULT_TABS[pathname] ?? 'overview';
}

export function getPatientPortalTabFromLocation(pathname: string, search: string): PatientDashboardTabId {
  const params = new URLSearchParams(search);
  const requestedTab = params.get('tab');
  if (requestedTab && VALID_TABS.has(requestedTab as PatientDashboardTabId)) {
    return requestedTab as PatientDashboardTabId;
  }

  return getPatientPortalDefaultTabForPath(pathname);
}

export function getPatientPortalPathForTab(tab: PatientDashboardTabId): string {
  const topLevelPath = getPatientPortalTopLevelPathForTab(tab);
  const defaultTab = getPatientPortalDefaultTabForPath(topLevelPath);

  if (tab === defaultTab) {
    return topLevelPath;
  }

  return `${topLevelPath}?tab=${tab}`;
}

export function getPatientPortalPathForBottomNav(tab: BottomNavTabId): string {
  if (tab === 'home') return SECTION_TO_PATH.home;
  if (tab === 'care') return SECTION_TO_PATH.care;
  if (tab === 'records') return SECTION_TO_PATH.records;
  return SECTION_TO_PATH.privacy;
}

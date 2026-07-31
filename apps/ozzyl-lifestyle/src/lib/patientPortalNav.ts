import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Building2,
  Calendar,
  ClipboardList,
  FileText,
  HeartPulse,
  Home,
  Link2,
  NotebookPen,
  Pill,
  ShieldCheck,
  Search,
  Shield,
  Sparkles,
  User,
} from 'lucide-react';

export type PatientDashboardTabId =
  | 'overview'
  | 'find-care'
  | 'hospital-services'
  | 'global-records'
  | 'vault'
  | 'data'
  | 'privacy'
  | 'trends'
  | 'tips'
  | 'diary-history'
  | 'medicine-tracker'
  | 'family'
  | 'wellness';

export type BottomNavTabId = 'home' | 'care' | 'records' | 'profile';

export interface PatientPortalNavItem {
  id: PatientDashboardTabId;
  labelKey: string;
  icon: LucideIcon;
}

export interface PatientPortalBottomNavItem {
  id: BottomNavTabId;
  labelKey: string;
  icon: LucideIcon;
}

export const PATIENT_PORTAL_PRIMARY_NAV: PatientPortalNavItem[] = [
  { id: 'overview', labelKey: 'sideNav.home', icon: Home },
  { id: 'hospital-services', labelKey: 'sideNav.care', icon: Building2 },
  { id: 'global-records', labelKey: 'sideNav.records', icon: FileText },
  { id: 'trends', labelKey: 'sideNav.wellness', icon: Activity },
  { id: 'family', labelKey: 'sideNav.familyHealth', icon: HeartPulse },
  { id: 'privacy', labelKey: 'sideNav.profile', icon: ShieldCheck },
];

export const PATIENT_PORTAL_SECONDARY_NAV: PatientPortalNavItem[] = [
  { id: 'find-care', labelKey: 'sideNav.findDoctor', icon: Search },
  { id: 'hospital-services', labelKey: 'sideNav.services', icon: Calendar },
  { id: 'data', labelKey: 'sideNav.myDiary', icon: NotebookPen },
  { id: 'privacy', labelKey: 'sideNav.privacy', icon: Shield },
  { id: 'vault', labelKey: 'sideNav.documents', icon: FileText },
  { id: 'global-records', labelKey: 'sideNav.healthRecord', icon: Link2 },
];

export const PATIENT_PORTAL_BOTTOM_NAV: PatientPortalBottomNavItem[] = [
  { id: 'home', labelKey: 'nav.home', icon: Home },
  { id: 'care', labelKey: 'nav.care', icon: Building2 },
  { id: 'records', labelKey: 'nav.records', icon: FileText },
  { id: 'profile', labelKey: 'nav.profile', icon: User },
];

const TAB_TO_NAV_SECTION: Record<PatientDashboardTabId, 'home' | 'care' | 'records' | 'wellness' | 'family' | 'profile'> = {
  overview: 'home',
  'find-care': 'care',
  'hospital-services': 'care',
  'global-records': 'records',
  vault: 'records',
  data: 'profile',
  privacy: 'profile',
  trends: 'wellness',
  tips: 'wellness',
  'diary-history': 'wellness',
  'medicine-tracker': 'wellness',
  family: 'family',
  wellness: 'wellness',
};

const SECTION_SHORTCUTS: Record<'home' | 'care' | 'records' | 'wellness' | 'family' | 'profile', PatientDashboardTabId[]> = {
  home: ['overview', 'data'],
  care: ['hospital-services', 'find-care'],
  records: ['global-records', 'vault'],
  wellness: ['trends', 'tips', 'diary-history', 'medicine-tracker', 'wellness'],
  family: ['family'],
  profile: ['privacy', 'data'],
};

export function getPatientPortalActiveNavSection(activeTab: PatientDashboardTabId) {
  return TAB_TO_NAV_SECTION[activeTab];
}

export function getPatientPortalSectionShortcuts(activeTab: PatientDashboardTabId): PatientPortalNavItem[] {
  const section = getPatientPortalActiveNavSection(activeTab);
  const ids = new Set(SECTION_SHORTCUTS[section]);
  return PATIENT_PORTAL_SECONDARY_NAV.filter((item) => ids.has(item.id));
}

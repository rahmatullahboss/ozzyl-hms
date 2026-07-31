import { useState, useEffect } from 'react';
import { X, Eye, HeartPulse, Pill, ClipboardList, Receipt, MoreVertical, FileText, Droplets, FlaskConical, UtensilsCrossed, Wind, ClipboardCheck, Clock, Stethoscope, Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import DrawerOverviewTab from './DrawerOverviewTab';
import DrawerVitalsTab from './DrawerVitalsTab';
import DrawerMARTab from './DrawerMARTab';
import DrawerOrdersTab from './DrawerOrdersTab';
import DrawerServicesTab from './DrawerServicesTab';
import DrawerNotesTab from './DrawerNotesTab';
import DrawerIOTab from './DrawerIOTab';
import DrawerIVFluidTab from './DrawerIVFluidTab';
import DrawerLabSampleTab from './DrawerLabSampleTab';
import DrawerCarePlanTab from './DrawerCarePlanTab';
import DrawerDietTab from './DrawerDietTab';
import DrawerRespiratoryTab from './DrawerRespiratoryTab';
import DrawerDischargeTab from './DrawerDischargeTab';
import DrawerActivityLogTab from './DrawerActivityLogTab';
import ICUFlowSheet from './ICUFlowSheet';
import EmergencyAlertButton from './EmergencyAlertButton';
import type { BedGridItem } from './WardBedGrid';

interface PatientDrawerProps {
  bed: BedGridItem | null;
  onClose: () => void;
}

type DrawerTab = 'overview' | 'vitals' | 'mar' | 'orders' | 'services' | 'notes' | 'io' | 'iv' | 'lab' | 'carePlan' | 'diet' | 'respiratory' | 'discharge' | 'activity' | 'icu';

const DRAWER_TAB_DEFS: { key: DrawerTab; icon: typeof HeartPulse; labelKey: string; icuOnly?: boolean }[] = [
  { key: 'overview',    icon: Eye,             labelKey: 'drawer.tabs.overview' },
  { key: 'vitals',      icon: HeartPulse,      labelKey: 'drawer.tabs.vitals' },
  { key: 'mar',         icon: Pill,            labelKey: 'drawer.tabs.mar' },
  { key: 'orders',      icon: ClipboardList,   labelKey: 'drawer.tabs.orders' },
  { key: 'services',    icon: Receipt,         labelKey: 'drawer.tabs.services' },
  { key: 'notes',       icon: FileText,        labelKey: 'drawer.tabs.notes' },
  { key: 'io',          icon: Droplets,        labelKey: 'drawer.tabs.io' },
  { key: 'iv',          icon: Droplets,        labelKey: 'drawer.tabs.iv' },
  { key: 'lab',         icon: FlaskConical,    labelKey: 'drawer.tabs.lab' },
  { key: 'carePlan',    icon: ClipboardCheck,  labelKey: 'drawer.tabs.carePlan' },
  { key: 'diet',        icon: UtensilsCrossed, labelKey: 'drawer.tabs.diet' },
  { key: 'respiratory', icon: Wind,            labelKey: 'drawer.tabs.respiratory' },
  { key: 'icu',         icon: Activity,        labelKey: 'drawer.tabs.icu', icuOnly: true },
  { key: 'discharge',   icon: ClipboardCheck,  labelKey: 'drawer.tabs.discharge' },
  { key: 'activity',    icon: Clock,           labelKey: 'drawer.tabs.activity' },
];

export default function PatientDrawer({ bed, onClose }: PatientDrawerProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview');
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Reset tab when bed changes
  useEffect(() => {
    setActiveTab('overview');
    setShowMoreMenu(false);
  }, [bed?.bed_id]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (bed) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [bed, onClose]);

  if (!bed || !bed.patient_id) return null;

  const moreActions = [
    { label: t('drawer.more.returnMedicine', { defaultValue: 'Return Medicine' }), href: '#' },
    { label: t('drawer.more.transferBed', { defaultValue: 'Transfer Bed' }), href: `${basePath}/admissions` },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
        data-testid="drawer-backdrop"
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-[var(--color-bg)] shadow-2xl z-50 flex flex-col" role="dialog" aria-modal="true" aria-labelledby="drawer-patient-name" data-testid="patient-drawer">
        {/* Sticky Patient Header */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
          <div className="flex items-center gap-3 min-w-0">
            {/* Avatar */}
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
              {bed.patient_name?.charAt(0) ?? '?'}
            </div>
            <div className="min-w-0">
              <h2 id="drawer-patient-name" className="text-lg font-bold text-[var(--color-text)] truncate">{bed.patient_name}</h2>
              <p className="text-sm text-[var(--color-text-muted)]">
                {bed.ward_name} — {bed.bed_number} · {bed.patient_code}
                {bed.blood_group ? ` · ${bed.blood_group}` : ''}
              </p>
              {bed.doctor_name && (
                <p className="text-xs text-[var(--color-text-muted)]">{bed.doctor_name}</p>
              )}
              {/* Clinical Risk Badges */}
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {(bed.allergy_count ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" data-testid="badge-allergy">
                    ⚠ {t('drawer.badges.allergies', { count: bed.allergy_count, defaultValue: `${bed.allergy_count} Allergies` })}
                  </span>
                )}
                {bed.fall_risk && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" data-testid="badge-fall-risk">
                    {t('drawer.badges.fallRisk', { defaultValue: 'Fall Risk' })}
                  </span>
                )}
                {bed.isolation && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" data-testid="badge-isolation">
                    {t('drawer.badges.isolation', { defaultValue: 'Isolation' })}
                  </span>
                )}
                {bed.is_diabetic && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" data-testid="badge-diabetic">
                    {t('drawer.badges.diabetic', { defaultValue: 'Diabetic' })}
                  </span>
                )}
                {bed.npo && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300" data-testid="badge-npo">
                    NPO
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <EmergencyAlertButton patientId={bed.patient_id} admissionId={bed.admission_id ?? 0} />
            {/* More menu trigger */}
            <div className="relative">
              <button
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                className="btn-ghost p-2"
                aria-label="More actions"
                data-testid="more-actions-btn"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
              {showMoreMenu && (
                <div className="absolute right-0 top-full mt-1 w-56 bg-[var(--color-bg)] rounded-xl shadow-xl border border-[var(--color-border)] py-2 z-50" data-testid="more-actions-menu">
                  {moreActions.map((action, i) => (
                    <a
                      key={i}
                      href={action.href}
                      onClick={() => setShowMoreMenu(false)}
                      className="block px-4 py-2.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-border-light)] transition-colors"
                    >
                      {action.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
            <button onClick={onClose} className="btn-ghost p-2" aria-label="Close" data-testid="drawer-close">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Critical Patient Banner */}
        {bed.admission_status === 'critical' && (
          <div className="px-5 py-2 bg-red-50 dark:bg-red-900/30 border-b border-red-200" data-testid="critical-banner">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              ⚠️ {t('drawer.criticalPatient', { defaultValue: 'Critical Patient — Monitor closely' })}
            </p>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b border-[var(--color-border)] px-2">
          {DRAWER_TAB_DEFS.filter(tab => !tab.icuOnly || (bed.ward_name ?? '').toUpperCase().includes('ICU')).map(tab => {
            const Icon = tab.icon;
            return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.key
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
              data-testid={`tab-${tab.key}`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{t(tab.labelKey)}</span>
            </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5" data-testid="tab-content">
          {activeTab === 'overview' && <DrawerOverviewTab bed={bed} />}
          {activeTab === 'vitals' && <DrawerVitalsTab bed={bed} />}
          {activeTab === 'mar' && <DrawerMARTab bed={bed} />}
          {activeTab === 'orders' && <DrawerOrdersTab bed={bed} />}
          {activeTab === 'services' && <DrawerServicesTab bed={bed} />}
          {activeTab === 'notes' && <DrawerNotesTab bed={bed} />}
          {activeTab === 'io' && <DrawerIOTab bed={bed} />}
          {activeTab === 'iv' && <DrawerIVFluidTab bed={bed} />}
          {activeTab === 'lab' && <DrawerLabSampleTab bed={bed} />}
          {activeTab === 'carePlan' && <DrawerCarePlanTab bed={bed} />}
          {activeTab === 'diet' && <DrawerDietTab bed={bed} />}
          {activeTab === 'respiratory' && <DrawerRespiratoryTab bed={bed} />}
          {activeTab === 'icu' && <ICUFlowSheet admissionId={bed.admission_id ?? 0} patientName={bed.patient_name ?? ''} />}
          {activeTab === 'discharge' && <DrawerDischargeTab bed={bed} />}
          {activeTab === 'activity' && <DrawerActivityLogTab bed={bed} />}
        </div>
      </div>
    </>
  );
}

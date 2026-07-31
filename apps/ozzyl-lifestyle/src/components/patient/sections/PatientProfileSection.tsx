import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PatientReportedDataTab from '../PatientReportedDataTab';
import { AllergyReactionTracker } from '../AllergyReactionTracker';
import PrivacyLockPanel from '../PrivacyLockPanel';
import { DeviceManagementCard } from '../DeviceManagementCard';
import PatientPrivacyTab from '../PatientPrivacyTab';
import type { PatientDashboardTabId } from '../../../lib/patientPortalNav';
import { PatientSectionIntro } from './PatientSectionIntro';
import { SectionSubTabs } from './SectionSubTabs';

interface PatientProfileSectionProps {
  activeTab: PatientDashboardTabId;
  onTabChange?: (tab: PatientDashboardTabId) => void;
}

export function PatientProfileSection({ activeTab, onTabChange }: PatientProfileSectionProps) {
  const { t } = useTranslation('patientPortal');

  if (activeTab !== 'data' && activeTab !== 'privacy') {
    return null;
  }

  const isData = activeTab === 'data';

  const tabs = [
    { id: 'data', label: t('sections.profile.tabMyData') },
    { id: 'privacy', label: t('sections.profile.tabPrivacy') },
  ];

  return (
    <div className="space-y-5 animate-fade-in-up">
      <PatientSectionIntro
        eyebrow={t('sections.profile.eyebrow')}
        title={isData ? t('sections.profile.dataTitle') : t('sections.profile.privacyTitle')}
        description={isData ? t('sections.profile.dataDesc') : t('sections.profile.privacyDesc')}
        icon={ShieldCheck}
        tone="slate"
      />
      {onTabChange && (
        <SectionSubTabs tabs={tabs} activeId={activeTab} onChange={(id) => onTabChange(id as PatientDashboardTabId)} />
      )}
      <div className="space-y-6">
        {isData ? (
          <>
            <PatientReportedDataTab />
            <AllergyReactionTracker />
          </>
        ) : (
          <>
            <PrivacyLockPanel />
            <DeviceManagementCard />
            <PatientPrivacyTab />
          </>
        )}
      </div>
    </div>
  );
}

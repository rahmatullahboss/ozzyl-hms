import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PatientVaultTab from '../PatientVaultTab';
import PatientGlobalRecordsTab from '../PatientGlobalRecordsTab';
import VisitPassQR from '../VisitPassQR';
import type { PatientDashboardTabId } from '../../../lib/patientPortalNav';
import { PatientSectionIntro } from './PatientSectionIntro';
import { SectionSubTabs } from './SectionSubTabs';

interface PatientRecordsSectionProps {
  activeTab: PatientDashboardTabId;
  onTabChange?: (tab: PatientDashboardTabId) => void;
}

export function PatientRecordsSection({ activeTab, onTabChange }: PatientRecordsSectionProps) {
  const { t } = useTranslation('patientPortal');

  if (activeTab !== 'vault' && activeTab !== 'global-records') {
    return null;
  }

  const isVault = activeTab === 'vault';

  const tabs = [
    { id: 'global-records', label: t('sections.records.tabHealthRecord') },
    { id: 'vault', label: t('sections.records.tabVault') },
  ];

  return (
    <div className="space-y-5 animate-fade-in-up">
      <PatientSectionIntro
        eyebrow={t('sections.records.eyebrow')}
        title={isVault ? t('sections.records.vaultTitle') : t('sections.records.globalTitle')}
        description={isVault ? t('sections.records.vaultDesc') : t('sections.records.globalDesc')}
        icon={FileText}
      />
      {onTabChange && (
        <SectionSubTabs tabs={tabs} activeId={activeTab} onChange={(id) => onTabChange(id as PatientDashboardTabId)} />
      )}
      <div className="space-y-6">
        {isVault ? (
          <PatientVaultTab />
        ) : (
          <>
            <PatientGlobalRecordsTab />
            <VisitPassQR />
          </>
        )}
      </div>
    </div>
  );
}

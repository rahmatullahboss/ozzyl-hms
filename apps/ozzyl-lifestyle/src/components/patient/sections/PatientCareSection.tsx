import { Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ConnectedCareTab from '../ConnectedCareTab';
import { LinkedHospitalsList } from '../LinkedHospitalsList';
import PatientFindCareTab from '../PatientFindCareTab';
import type { PatientDashboardTabId } from '../../../lib/patientPortalNav';
import { useHospitalLinks } from '../../../hooks/useConnectedCare';
import { PatientSectionIntro } from './PatientSectionIntro';
import { SectionSubTabs } from './SectionSubTabs';

interface PatientCareSectionProps {
  activeTab: PatientDashboardTabId;
  onTabChange: (tab: PatientDashboardTabId) => void;
}

export function PatientCareSection({ activeTab, onTabChange }: PatientCareSectionProps) {
  const { t } = useTranslation('patientPortal');
  const hospitalLinksQuery = useHospitalLinks();

  if (activeTab !== 'find-care' && activeTab !== 'hospital-services') {
    return null;
  }

  const isFindCare = activeTab === 'find-care';

  const tabs = [
    { id: 'hospital-services', label: t('sections.care.tabMyHospitals') },
    { id: 'find-care', label: t('sections.care.tabFindCare') },
  ];

  return (
    <div className="space-y-5 animate-fade-in-up">
      <PatientSectionIntro
        eyebrow={t('sections.care.eyebrow')}
        title={isFindCare ? t('sections.care.findCareTitle') : t('sections.care.workspaceTitle')}
        description={isFindCare ? t('sections.care.findCareDesc') : t('sections.care.workspaceDesc')}
        icon={Building2}
      />
      <SectionSubTabs tabs={tabs} activeId={activeTab} onChange={(id) => onTabChange(id as PatientDashboardTabId)} />
      <div className="space-y-6">
        {isFindCare ? (
          <PatientFindCareTab />
        ) : (
          <>
            <LinkedHospitalsList
              hospitals={hospitalLinksQuery.data?.hospitals ?? []}
              isLoading={hospitalLinksQuery.isLoading}
              onAddHospital={() => onTabChange('find-care')}
            />
            <ConnectedCareTab onFindHospital={() => onTabChange('find-care')} />
          </>
        )}
      </div>
    </div>
  );
}

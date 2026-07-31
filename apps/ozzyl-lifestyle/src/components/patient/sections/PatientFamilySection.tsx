import { HeartPulse } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FamilyHealthHub } from '../FamilyHealthHub';
import SocialChallenges from '../SocialChallenges';
import type { PatientDashboardTabId } from '../../../lib/patientPortalNav';
import { PatientSectionIntro } from './PatientSectionIntro';

interface PatientFamilySectionProps {
  activeTab: PatientDashboardTabId;
}

export function PatientFamilySection({ activeTab }: PatientFamilySectionProps) {
  const { t } = useTranslation('patientPortal');

  if (activeTab !== 'family') {
    return null;
  }

  return (
    <div className="space-y-5 animate-fade-in-up">
      <PatientSectionIntro
        eyebrow={t('sections.family.eyebrow')}
        title={t('sections.family.title')}
        description={t('sections.family.description')}
        icon={HeartPulse}
        tone="emerald"
      />
      <div className="space-y-6">
        <FamilyHealthHub />
        <SocialChallenges />
      </div>
    </div>
  );
}

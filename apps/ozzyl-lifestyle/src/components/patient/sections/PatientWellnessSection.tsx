import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import WellnessTrendsTab from '../WellnessTrendsTab';
import NutritionModule from '../NutritionModule';
import SleepModule from '../SleepModule';
import ActivityModule from '../ActivityModule';
import VitalsModule from '../VitalsModule';
import { VitalsDashboard } from '../VitalsDashboard';
import { SeasonalAlertsWidget } from '../SeasonalAlertsWidget';
import { RamadanModeWidget } from '../RamadanModeWidget';
import HealthTipsFeed from '../HealthTipsFeed';
import DiaryHistoryTab from '../DiaryHistoryTab';
import FoodDiary from '../FoodDiary';
import MedicineTrackerTab from '../MedicineTrackerTab';
import { MedicineReminders } from '../MedicineReminders';
import PatientAIPlannerTab from '../PatientAIPlannerTab';
import { WellnessHubSection } from '../WellnessHubSection';
import AchievementGallery from '../AchievementGallery';
import MentalHealthScreen from '../MentalHealthScreen';
import ScreeningHistory from '../ScreeningHistory';
import CycleTracker from '../CycleTracker';
import CycleCalendar from '../CycleCalendar';
import PregnancyModeCard from '../PregnancyModeCard';
import DeviceSyncCard from '../DeviceSyncCard';
import WalkingChallengesCard from '../WalkingChallengesCard';
import BreathingExercise from '../BreathingExercise';
import WellnessContentPlayer from '../WellnessContentPlayer';
import PrivacyLockPanel, { SensitiveModuleGate } from '../PrivacyLockPanel';
import type { PatientDashboardTabId } from '../../../lib/patientPortalNav';
import { PatientSectionIntro } from './PatientSectionIntro';
import { SectionSubTabs } from './SectionSubTabs';

interface PatientWellnessSectionProps {
  activeTab: PatientDashboardTabId;
  isSessionReady: boolean;
  onLogFood: () => void;
  onTabChange?: (tab: PatientDashboardTabId) => void;
}

const WELLNESS_TABS: PatientDashboardTabId[] = ['trends', 'tips', 'diary-history', 'medicine-tracker', 'wellness'];

const INTRO_MAP: Record<string, { titleKey: string; descKey: string }> = {
  trends: { titleKey: 'sections.wellness.trendsTitle', descKey: 'sections.wellness.trendsDesc' },
  tips: { titleKey: 'sections.wellness.tipsTitle', descKey: 'sections.wellness.tipsDesc' },
  'diary-history': { titleKey: 'sections.wellness.diaryTitle', descKey: 'sections.wellness.diaryDesc' },
  'medicine-tracker': { titleKey: 'sections.wellness.medsTitle', descKey: 'sections.wellness.medsDesc' },
  wellness: { titleKey: 'sections.wellness.hubTitle', descKey: 'sections.wellness.hubDesc' },
};

export function PatientWellnessSection({
  activeTab,
  isSessionReady,
  onLogFood,
  onTabChange,
}: PatientWellnessSectionProps) {
  const { t } = useTranslation('patientPortal');

  if (!WELLNESS_TABS.includes(activeTab)) {
    return null;
  }

  const introKeys = INTRO_MAP[activeTab] ?? INTRO_MAP.trends;

  const tabs = [
    { id: 'trends', label: t('sections.wellness.tabTrends') },
    { id: 'tips', label: t('sections.wellness.tabTips') },
    { id: 'diary-history', label: t('sections.wellness.tabJournal') },
    { id: 'medicine-tracker', label: t('sections.wellness.tabMeds') },
    { id: 'wellness', label: t('sections.wellness.tabHub') },
  ];

  return (
    <div className="space-y-5 animate-fade-in-up">
      <PatientSectionIntro
        eyebrow={t('sections.wellness.eyebrow')}
        title={t(introKeys.titleKey)}
        description={t(introKeys.descKey)}
        icon={Activity}
      />
      {onTabChange && (
        <SectionSubTabs tabs={tabs} activeId={activeTab} onChange={(id) => onTabChange(id as PatientDashboardTabId)} />
      )}
      <div className="space-y-6">
        {activeTab === 'trends' && (
          <>
            <NutritionModule onLogFood={onLogFood} />
            <SleepModule isSessionReady={isSessionReady} />
            <ActivityModule isSessionReady={isSessionReady} />
            <VitalsModule isSessionReady={isSessionReady} />
            <VitalsDashboard />
            <WellnessTrendsTab isSessionReady={isSessionReady} />
          </>
        )}

        {activeTab === 'tips' && (
          <>
            <RamadanModeWidget />
            <SeasonalAlertsWidget recentSymptoms={[]} />
            <HealthTipsFeed />
          </>
        )}

        {activeTab === 'diary-history' && (
          <>
            <DiaryHistoryTab isSessionReady={isSessionReady} />
            <FoodDiary />
          </>
        )}

        {activeTab === 'medicine-tracker' && (
          <>
            <MedicineTrackerTab />
            <MedicineReminders />
          </>
        )}

        {activeTab === 'wellness' && (
          <>
            <PatientAIPlannerTab />
            <WellnessHubSection />
            <AchievementGallery />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <SensitiveModuleGate module="mental-health" title="Mental health">
                <MentalHealthScreen />
                <div className="mt-6">
                  <ScreeningHistory />
                </div>
              </SensitiveModuleGate>
              <SensitiveModuleGate module="womens-health" title="Women&apos;s health">
                <CycleTracker />
                <div className="mt-6">
                  <CycleCalendar />
                </div>
              </SensitiveModuleGate>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <SensitiveModuleGate module="pregnancy" title="Pregnancy mode">
                <PregnancyModeCard />
              </SensitiveModuleGate>
              <DeviceSyncCard />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <WalkingChallengesCard />
              <BreathingExercise />
            </div>
            <WellnessContentPlayer />
          </>
        )}
      </div>
    </div>
  );
}

import { useSearchParams } from 'react-router';
import { Calculator, DollarSign, Briefcase, History, type LucideIcon } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import OverviewTab from './payroll/OverviewTab';
import SalaryHeadsTab from './payroll/SalaryHeadsTab';
import SalaryStructureTab from './payroll/SalaryStructureTab';
import RunsHistoryTab from './payroll/RunsHistoryTab';

type Tab = 'overview' | 'heads' | 'structure' | 'runs';
const TAB_VALUES: Tab[] = ['overview', 'heads', 'structure', 'runs'];

export default function PayrollGeneration({ role }: { role?: string }) {
  const { t } = useTranslation(['hr']);
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const activeTab: Tab = (TAB_VALUES as string[]).includes(raw ?? '') ? (raw as Tab) : 'overview';

  const setTab = (tab: Tab) => {
    const next = new URLSearchParams(params);
    if (tab === 'overview') next.delete('tab'); else next.set('tab', tab);
    setParams(next, { replace: true });
  };

  const tabs: { key: Tab; icon: React.ReactElement<LucideIcon>; labelKey: string }[] = [
    { key: 'overview',  icon: <Calculator className="w-4 h-4" />, labelKey: 'hr:payroll.tabs.overview' },
    { key: 'heads',     icon: <DollarSign className="w-4 h-4" />, labelKey: 'hr:payroll.tabs.heads' },
    { key: 'structure', icon: <Briefcase className="w-4 h-4" />, labelKey: 'hr:payroll.tabs.structure' },
    { key: 'runs',      icon: <History className="w-4 h-4" />, labelKey: 'hr:payroll.tabs.runs' },
  ];

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <h1 className="page-title">{t('hr:payroll.title')}</h1>
          <p className="section-subtitle">{t('hr:subtitle')}</p>
        </div>

        <div className="flex gap-1 border border-[var(--color-border)] rounded-xl p-1 bg-[var(--color-bg-card)] w-fit" role="tablist">
          {tabs.map((tab) => (
            <button key={tab.key} onClick={() => setTab(tab.key)} role="tab" aria-selected={activeTab === tab.key}
              data-tab={tab.key}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                activeTab === tab.key
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border-light)]'
              }`}>
              {tab.icon}{t(tab.labelKey)}
            </button>
          ))}
        </div>

        <div role="tabpanel" data-active-tab={activeTab}>
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'heads' && <SalaryHeadsTab />}
          {activeTab === 'structure' && <SalaryStructureTab />}
          {activeTab === 'runs' && <RunsHistoryTab />}
        </div>
      </div>
    </DashboardLayout>
  );
}

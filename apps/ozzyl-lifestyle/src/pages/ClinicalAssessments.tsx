import { useState } from 'react';
import {
  Brain, ListChecks, Stethoscope, BookOpen, UtensilsCrossed, Droplet, Search
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import ProblemListTab from '../components/clinical/ProblemListTab';
import DiagnosisTab from '../components/clinical/DiagnosisTab';
import HistoryTab from '../components/clinical/HistoryTab';
import AssessmentsTab from '../components/clinical/AssessmentsTab';
import DietTab from '../components/clinical/DietTab';
import GlucoseTab from '../components/clinical/GlucoseTab';

export default function ClinicalAssessments({ role = 'doctor' }: { role?: string }) {
  const { t } = useTranslation(['clinical']);
  const [activeTab, setActiveTab] = useState<string>('problems');
  const [patientId, setPatientId] = useState<number | ''>('');
  const [filterInput, setFilterInput] = useState('');

  const TABS = [
    { key: 'problems', label: t('tabs.problems'), icon: <ListChecks className="w-4 h-4" /> },
    { key: 'diagnosis', label: t('tabs.diagnosis'), icon: <Stethoscope className="w-4 h-4" /> },
    { key: 'history', label: t('tabs.history'), icon: <BookOpen className="w-4 h-4" /> },
    { key: 'assessments', label: t('tabs.assessments'), icon: <Brain className="w-4 h-4" /> },
    { key: 'diet', label: t('tabs.diet'), icon: <UtensilsCrossed className="w-4 h-4" /> },
    { key: 'glucose', label: t('tabs.glucose'), icon: <Droplet className="w-4 h-4" /> },
  ];

  const handleSearch = () => {
    if (filterInput) setPatientId(Number(filterInput));
    else setPatientId('');
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title')}</h1>
              <p className="section-subtitle">{t('subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Patient Selection */}
        <div className="card p-3 flex gap-3 items-center">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="number"
              placeholder={t('searchPlaceholder')}
              value={filterInput}
              onChange={e => setFilterInput(e.target.value)}
              className="input pl-9 w-64"
            />
          </div>
          <button onClick={handleSearch} className="btn-primary">{t('loadPatient')}</button>
          {patientId && (
            <button onClick={() => { setPatientId(''); setFilterInput(''); }} className="btn-ghost text-sm">
              {t('clear')}
            </button>
          )}
        </div>

        {patientId ? (
          <div className="card flex flex-col min-h-[600px]">
            {/* Tabs Header */}
            <div className="flex overflow-x-auto border-b border-gray-100 dark:border-gray-800 p-2 hide-scrollbar">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                    activeTab === tab.key
                      ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/50 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="p-5 flex-1">
              {activeTab === 'problems' && <ProblemListTab patientId={patientId} />}
              {activeTab === 'diagnosis' && <DiagnosisTab patientId={patientId} />}
              {activeTab === 'history' && <HistoryTab patientId={patientId} />}
              {activeTab === 'assessments' && <AssessmentsTab patientId={patientId} />}
              {activeTab === 'diet' && <DietTab patientId={patientId} />}
              {activeTab === 'glucose' && <GlucoseTab patientId={patientId} />}
            </div>
          </div>
        ) : (
          <div className="card p-12 flex flex-col items-center justify-center text-gray-500 min-h-[400px]">
            <Search className="w-12 h-12 mb-4 text-gray-300 dark:text-gray-700" />
            <p className="text-lg font-medium text-gray-900 dark:text-white">{t('noPatientSelected')}</p>
            <p className="text-sm mt-1">{t('noPatientDesc')}</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

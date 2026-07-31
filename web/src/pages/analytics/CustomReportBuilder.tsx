import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../../components/DashboardLayout';

type Step = 'module' | 'columns' | 'filters' | 'preview';

type ModuleDef = {
  id: string;
  nameKey: string;
  columns: string[];
};

const MODULES: ModuleDef[] = [
  { id: 'billing', nameKey: 'customReportBuilder.module.billing', columns: ['Invoice Number', 'Patient Name', 'Amount', 'Date', 'Payment Mode', 'Status', 'Discount', 'Due'] },
  { id: 'patients', nameKey: 'customReportBuilder.module.patients', columns: ['Patient ID', 'Name', 'Age', 'Gender', 'Phone', 'Address', 'Registration Date'] },
  { id: 'lab', nameKey: 'customReportBuilder.module.lab', columns: ['Order ID', 'Patient Name', 'Test Name', 'Status', 'Sample Date', 'Report Date', 'Doctor'] },
  { id: 'pharmacy', nameKey: 'customReportBuilder.module.pharmacy', columns: ['Invoice ID', 'Patient Name', 'Medicine', 'Quantity', 'Amount', 'Date', 'Batch'] },
  { id: 'ipd', nameKey: 'customReportBuilder.module.ipd', columns: ['Admission ID', 'Patient Name', 'Bed', 'Ward', 'Doctor', 'Admission Date', 'Discharge Date', 'Diagnosis'] },
  { id: 'expenses', nameKey: 'customReportBuilder.module.expenses', columns: ['Expense ID', 'Category', 'Amount', 'Date', 'Payment Mode', 'Approved By', 'Vendor'] },
];

const FILTERS = ['Date Range', 'Department', 'Amount Range', 'Doctor', 'Status', 'Payment Mode'];

export default function CustomReportBuilder() {
  const { t } = useTranslation(['tenantAdmin']);
  const [step, setStep] = useState<Step>('module');
  const [selectedModule, setSelectedModule] = useState<ModuleDef | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);

  const handleSelectModule = (mod: ModuleDef) => {
    setSelectedModule(mod);
    setSelectedColumns([]);
    setStep('columns');
  };

  const handleToggleColumn = (col: string) => {
    setSelectedColumns((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
  };

  const handleNext = () => {
    if (step === 'columns') setStep('filters');
    else if (step === 'filters') setStep('preview');
  };

  const handleBack = () => {
    if (step === 'filters') setStep('columns');
    else if (step === 'preview') setStep('filters');
    else if (step === 'columns') setStep('module');
  };

  return (
    <DashboardLayout role="hospital_admin">
      <h1 className="text-2xl font-bold mb-6">{t('customReportBuilder.title')}</h1>

      {/* Step Indicator */}
      <div className="flex items-center gap-4 mb-6">
        {(['module', 'columns', 'filters', 'preview'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
              step === s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
            }`}>
              {i + 1}
            </div>
            <span className={`text-sm ${step === s ? 'font-semibold' : 'text-gray-500'}`}>
              {t(`customReportBuilder.step.${s}`)}
            </span>
            {i < 3 && <div className="w-8 h-px bg-gray-300" />}
          </div>
        ))}
      </div>

      {/* Step 1: Module Selection */}
      {step === 'module' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">{t('customReportBuilder.chooseModule')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {MODULES.map((mod) => (
              <button
                key={mod.id}
                onClick={() => handleSelectModule(mod)}
                className={`p-4 rounded-lg border-2 text-left transition-colors ${
                  selectedModule?.id === mod.id
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
                }`}
              >
                <p className="font-medium">{t(mod.nameKey)}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {t('customReportBuilder.columnsAvailable', { count: mod.columns.length })}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Column Selection */}
      {step === 'columns' && selectedModule && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">{t('customReportBuilder.chooseColumns')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {selectedModule.columns.map((col) => (
              <label
                key={col}
                className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedColumns.includes(col)
                    ? 'border-blue-600 bg-blue-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedColumns.includes(col)}
                  onChange={() => handleToggleColumn(col)}
                  className="rounded"
                />
                <span className="text-sm">{col}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2 mt-6">
            <button onClick={handleBack} className="px-4 py-2 bg-gray-100 rounded-lg text-sm">
              {t('customReportBuilder.back')}
            </button>
            <button
              onClick={handleNext}
              disabled={selectedColumns.length === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
            >
              {t('customReportBuilder.next')}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Filters */}
      {step === 'filters' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">{t('customReportBuilder.addFilters')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {FILTERS.map((filter) => (
              <div key={filter}>
                <label className="text-xs text-gray-500">{filter}</label>
                {filter === 'Date Range' ? (
                  <div className="flex gap-2 mt-1">
                    <input type="date" className="border rounded px-2 py-1 text-sm flex-1" />
                    <input type="date" className="border rounded px-2 py-1 text-sm flex-1" />
                  </div>
                ) : filter === 'Amount Range' ? (
                  <div className="flex gap-2 mt-1">
                    <input type="number" placeholder="Min" className="border rounded px-2 py-1 text-sm flex-1" />
                    <input type="number" placeholder="Max" className="border rounded px-2 py-1 text-sm flex-1" />
                  </div>
                ) : (
                  <select className="w-full border rounded px-2 py-1 text-sm mt-1">
                    <option>{t('customReportBuilder.all')}</option>
                  </select>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-6">
            <button onClick={handleBack} className="px-4 py-2 bg-gray-100 rounded-lg text-sm">
              {t('customReportBuilder.back')}
            </button>
            <button onClick={handleNext} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
              {t('customReportBuilder.next')}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Preview & Export */}
      {step === 'preview' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">{t('customReportBuilder.previewExport')}</h2>
          <div className="mb-4">
            <p className="text-sm text-gray-500">
              {t('customReportBuilder.moduleLabel')}:{' '}
              <span className="font-medium">{selectedModule ? t(selectedModule.nameKey) : ''}</span>
            </p>
            <p className="text-sm text-gray-500">
              {t('customReportBuilder.columnsLabel')}:{' '}
              <span className="font-medium">{selectedColumns.join(', ')}</span>
            </p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <p className="text-sm text-gray-500 text-center py-8">
              {t('customReportBuilder.previewPlaceholder')}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={handleBack} className="px-4 py-2 bg-gray-100 rounded-lg text-sm">
              {t('customReportBuilder.back')}
            </button>
            <button className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm">
              {t('customReportBuilder.exportPdf')}
            </button>
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
              {t('customReportBuilder.exportExcel')}
            </button>
            <button className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm">
              {t('customReportBuilder.saveTemplate')}
            </button>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

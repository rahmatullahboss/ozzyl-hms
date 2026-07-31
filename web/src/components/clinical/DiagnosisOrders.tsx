import { useState, useCallback } from 'react';
import { Search, Plus, Trash2, FlaskConical, Pill, Scan, ChevronDown, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface Diagnosis {
  id: number;
  icd_code: string;
  icd_description: string;
  diagnosis_type: 'primary' | 'secondary' | 'admitting' | 'discharge';
  notes?: string;
  patient_id: number;
  encounter_id?: number;
  created_at: string;
}

interface DiagnosisSearchResult {
  code: string;
  description: string;
  system: string;
}

interface LinkedOrder {
  type: 'lab' | 'imaging' | 'medication';
  id: string;
  name: string;
  details?: string;
}

interface DiagnosisOrdersProps {
  patientId: string;
  onOrderCreated?: () => void;
}

export default function DiagnosisOrders({ patientId, onOrderCreated }: DiagnosisOrdersProps) {
  const { t } = useTranslation('clinical');
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [selectedDiagnosis, setSelectedDiagnosis] = useState<Diagnosis | null>(null);
  const [showOrderPanel, setShowOrderPanel] = useState(false);
  const [orderType, setOrderType] = useState<'lab' | 'imaging' | 'medication'>('lab');
  const [orderNotes, setOrderNotes] = useState('');

  // Fetch diagnoses
  const diagnosesQuery = useApiQuery<Diagnosis[]>(
    queryKeys.clinical.diagnosis(patientId),
    `/api/clinical/diagnosis?patientId=${patientId}`,
    { enabled: !!patientId }
  );

  // Search ICD codes
  const searchQuery = useApiQuery<DiagnosisSearchResult[]>(
    ['clinical', 'diagnosis', 'search', searchTerm],
    `/api/clinical/diagnosis/search?q=${encodeURIComponent(searchTerm)}`,
    { enabled: searchTerm.length >= 2 }
  );

  // Add diagnosis mutation
  const addDiagnosisMutation = useApiMutation<unknown, { patientId: number; icdCode: string; icdDescription: string; diagnosisType: string; notes?: string }>(
    'post',
    '/api/clinical/diagnosis',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.clinical.diagnosis(patientId) });
        toast.success(t('diagnosis.added', { defaultValue: 'Diagnosis added' }));
        setShowSearch(false);
        setSearchTerm('');
      },
      onError: () => toast.error(t('diagnosisaddError', { defaultValue: 'Failed to add diagnosis' })),
    }
  );

  // Remove diagnosis mutation
  const removeDiagnosisMutation = useApiMutation<unknown, { id: number }>(
    'delete',
    (vars) => `/api/clinical/diagnosis/${vars.id}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.clinical.diagnosis(patientId) });
        toast.success(t('diagnosis.removed', { defaultValue: 'Diagnosis removed' }));
      },
      onError: () => toast.error(t('diagnosisRemoveError', { defaultValue: 'Failed to remove diagnosis' })),
    }
  );

  // Lab order mutation
  const labOrderMutation = useApiMutation<unknown, { testName: string; diagnosisId?: number; notes?: string }>(
    'post',
    `/api/patients/${patientId}/chart/lab-order`,
    {
      onSuccess: () => {
        toast.success(t('orders.labOrdered', { defaultValue: 'Lab order placed' }));
        setShowOrderPanel(false);
        setOrderNotes('');
        onOrderCreated?.();
      },
      onError: () => toast.error(t('orders.labOrderError', { defaultValue: 'Failed to place lab order' })),
    }
  );

  // Imaging order mutation
  const imagingOrderMutation = useApiMutation<unknown, { imagingType: string; bodyPart?: string; urgency?: string; diagnosisId?: number; notes?: string }>(
    'post',
    `/api/patients/${patientId}/chart/radiology-order`,
    {
      onSuccess: () => {
        toast.success(t('orders.imagingOrdered', { defaultValue: 'Imaging order placed' }));
        setShowOrderPanel(false);
        setOrderNotes('');
        onOrderCreated?.();
      },
      onError: () => toast.error(t('orders.imagingOrderError', { defaultValue: 'Failed to place imaging order' })),
    }
  );

  const diagnoses = diagnosesQuery.data ?? [];
  const searchResults = searchQuery.data ?? [];

  const handleAddDiagnosis = useCallback((result: DiagnosisSearchResult) => {
    addDiagnosisMutation.mutate({
      patientId: Number(patientId),
      icdCode: result.code,
      icdDescription: result.description,
      diagnosisType: diagnoses.length === 0 ? 'primary' : 'secondary',
    });
  }, [patientId, diagnoses.length, addDiagnosisMutation]);

  const handleRemoveDiagnosis = useCallback((id: number) => {
    removeDiagnosisMutation.mutate({ id });
  }, [removeDiagnosisMutation]);

  const handleCreateOrder = useCallback(() => {
    if (!selectedDiagnosis) return;

    if (orderType === 'lab') {
      labOrderMutation.mutate({
        testName: orderNotes || 'Lab order',
        diagnosisId: selectedDiagnosis.id,
        notes: orderNotes,
      });
    } else if (orderType === 'imaging') {
      imagingOrderMutation.mutate({
        imagingType: orderNotes || 'X-Ray',
        diagnosisId: selectedDiagnosis.id,
        notes: orderNotes,
      });
    }
  }, [selectedDiagnosis, orderType, orderNotes, labOrderMutation, imagingOrderMutation]);

  const DIAGNOSIS_TYPE_STYLES: Record<string, string> = {
    primary: 'bg-red-100 text-red-700',
    secondary: 'bg-amber-100 text-amber-700',
    admitting: 'bg-blue-100 text-blue-700',
    discharge: 'bg-emerald-100 text-emerald-700',
  };

  return (
    <div className="space-y-4">
      {/* Diagnosis list */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Search className="w-4 h-4 text-[var(--color-primary)]" />
            {t('diagnosis.title', { defaultValue: 'Diagnoses' })}
          </h3>
          <button
            className="btn-ghost text-xs flex items-center gap-1"
            onClick={() => setShowSearch(!showSearch)}
           aria-label={t('diagnosis.add', { defaultValue: 'Add Diagnosis' })}>
            <Plus className="w-3.5 h-3.5" />
            {t('diagnosis.add', { defaultValue: 'Add' })}
          </button>
        </div>

        {/* Search panel */}
        {showSearch && (
          <div className="mb-3 p-3 rounded-lg bg-[var(--color-bg)] border border-[var(--color-border)]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
              <input
                type="text"
                className="input pl-9 w-full"
                placeholder={t('diagnosis.searchPlaceholder', { defaultValue: 'Search ICD-10 codes...' })}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                autoFocus
              />
            </div>
            {searchTerm.length >= 2 && searchQuery.isLoading && (
              <p className="text-xs text-[var(--color-text-muted)] mt-2">{t('diagnosis.searching', { defaultValue: 'Searching...' })}</p>
            )}
            {searchResults.length > 0 && (
              <div className="mt-2 max-h-48 overflow-y-auto space-y-1">
                {searchResults.map((result) => (
                  <button
                    key={result.code}
                    className="w-full text-left p-2 rounded-lg hover:bg-[var(--color-bg-card)] transition-colors text-sm"
                    onClick={() => handleAddDiagnosis(result)}
                  >
                    <span className="font-mono text-xs text-[var(--color-primary)] mr-2">{result.code}</span>
                    <span>{result.description}</span>
                  </button>
                ))}
              </div>
            )}
            {searchTerm.length >= 2 && searchResults.length === 0 && !searchQuery.isLoading && (
              <p className="text-xs text-[var(--color-text-muted)] mt-2">{t('diagnosis.noResults', { defaultValue: 'No results found' })}</p>
            )}
            <button
              className="text-xs text-[var(--color-text-muted)] mt-2 hover:text-[var(--color-text)]"
              onClick={() => { setShowSearch(false); setSearchTerm(''); }}
             aria-label={t('common:close', { defaultValue: 'Close' })}>
              {t('common:close', { defaultValue: 'Close' })}
            </button>
          </div>
        )}

        {/* Diagnosis items */}
        {diagnoses.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">{t('diagnosis.empty', { defaultValue: 'No diagnoses recorded' })}</p>
        ) : (
          <div className="space-y-2">
            {diagnoses.map((dx) => (
              <div key={dx.id} className="flex items-start justify-between gap-2 p-2 rounded-lg bg-[var(--color-bg)]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-[var(--color-primary)]">{dx.icd_code}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${DIAGNOSIS_TYPE_STYLES[dx.diagnosis_type] || 'bg-gray-100 text-gray-700'}`}>
                      {dx.diagnosis_type}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--color-text)] mt-0.5 truncate">{dx.icd_description}</p>
                  {dx.notes && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{dx.notes}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    className="btn-ghost text-xs p-1"
                    title={t('diagnosis.orderFrom', { defaultValue: 'Create order from this diagnosis' })} aria-label={t('diagnosis.orderFrom', { defaultValue: 'Create order from this diagnosis' })}
                    onClick={() => { setSelectedDiagnosis(dx); setShowOrderPanel(true); }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    className="btn-ghost text-xs p-1 text-red-500 hover:text-red-700"
                    title={t('diagnosis.remove', { defaultValue: 'Remove' })} aria-label={t('diagnosis.remove', { defaultValue: 'Remove' })}
                    onClick={() => handleRemoveDiagnosis(dx.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Order panel (shown when creating order from diagnosis) */}
      {showOrderPanel && selectedDiagnosis && (
        <div className="card p-4 border-l-4 border-l-[var(--color-primary)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">
              {t('orders.createFrom', { defaultValue: 'Create Order' })}: {selectedDiagnosis.icd_code}
            </h3>
            <button className="btn-ghost p-1" onClick={() => setShowOrderPanel(false)} aria-label="Close order panel">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex gap-2 mb-3">
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                orderType === 'lab' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text)] hover:bg-[var(--color-bg-card)]'
              }`}
              onClick={() => setOrderType('lab')}
            >
              <FlaskConical className="w-3.5 h-3.5" />
              {t('orders.lab', { defaultValue: 'Lab' })}
            </button>
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                orderType === 'imaging' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text)] hover:bg-[var(--color-bg-card)]'
              }`}
              onClick={() => setOrderType('imaging')}
            >
              <Scan className="w-3.5 h-3.5" />
              {t('orders.imaging', { defaultValue: 'Imaging' })}
            </button>
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                orderType === 'medication' ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text)] hover:bg-[var(--color-bg-card)]'
              }`}
              onClick={() => setOrderType('medication')}
            >
              <Pill className="w-3.5 h-3.5" />
              {t('orders.medication', { defaultValue: 'Medication' })}
            </button>
          </div>

          <div>
            <label className="label">{t('orders.notes', { defaultValue: 'Notes / Details' })}</label>
            <textarea
              className="input min-h-[60px]"
              placeholder={orderType === 'lab' ? t('orders.labPlaceholder', { defaultValue: 'Test name or notes...' }) : orderType === 'imaging' ? t('orders.imagingPlaceholder', { defaultValue: 'Imaging type, body part...' }) : t('orders.medPlaceholder', { defaultValue: 'Medication details...'})}
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
            />
          </div>

          <div className="flex gap-2 mt-3">
            <button
              className="btn-primary text-xs"
              onClick={handleCreateOrder}
              disabled={labOrderMutation.isPending || imagingOrderMutation.isPending}
            >
              {t('orders.create', { defaultValue: 'Create Order' })}
            </button>
            <button className="btn-ghost text-xs" onClick={() => setShowOrderPanel(false)}>
              {t('common:cancel', { defaultValue: 'Cancel' })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

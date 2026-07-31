import { useState } from 'react';
import { Droplets, Plus, X, RefreshCw, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import type { BedGridItem } from './WardBedGrid';

interface IORecord {
  id: number;
  patient_id: number;
  intake_type?: string;
  intake_amount?: number;
  intake_unit?: string;
  output_type?: string;
  output_amount?: number;
  output_unit?: string;
  remarks?: string;
  recorded_on: string;
}

interface FluidBalance {
  total_intake: number;
  total_output: number;
  balance: number;
  period: string;
}

interface DrawerIOTabProps {
  bed: BedGridItem;
}

export default function DrawerIOTab({ bed }: DrawerIOTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    io_type: 'intake' as 'intake' | 'output',
    item_name: '',
    quantity: '',
    unit: 'ml',
    remarks: '',
  });

  const recordsQuery = useApiQuery<{ Results?: IORecord[] }>(
    queryKeys.nursing.io(bed.patient_id!),
    `/api/nursing/io?patient_id=${bed.patient_id}&limit=10`,
    { enabled: !!bed.patient_id },
  );
  const records = recordsQuery.data?.Results ?? [];

  const balanceQuery = useApiQuery<FluidBalance>(
    ['nursing', 'io', 'balance', bed.patient_id],
    `/api/nursing/io/balance/${bed.patient_id}?period=24`,
    { enabled: !!bed.patient_id },
  );

  const createMutation = useApiMutation('post', '/api/nursing/io', {
    onSuccess: () => {
      toast.success(t('io.recorded', { defaultValue: 'Recorded' }));
      setForm({ io_type: 'intake', item_name: '', quantity: '', unit: 'ml', remarks: '' });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.io(bed.patient_id!) });
      queryClient.invalidateQueries({ queryKey: ['nursing', 'io', 'balance', bed.patient_id] });
    },
    onError: (err) => toast.error(err.message || t('io.failed', { defaultValue: 'Failed to record' })),
  });

  const deleteMutation = useApiMutation('delete', (id: number) => `/api/nursing/io/${id}`, {
    onSuccess: () => {
      toast.success(t('io.deleted', { defaultValue: 'Deleted' }));
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.io(bed.patient_id!) });
      queryClient.invalidateQueries({ queryKey: ['nursing', 'io', 'balance', bed.patient_id] });
    },
    onError: () => toast.error(t('io.deleteFailed', { defaultValue: 'Delete failed' })),
  });

  const handleSave = () => {
    if (!form.item_name.trim() || !form.quantity) {
      toast.error(t('io.fieldsRequired', { defaultValue: 'Item name and quantity required' }));
      return;
    }
    const payload: Record<string, unknown> = {
      patient_id: bed.patient_id,
      remarks: form.remarks || undefined,
    };
    if (form.io_type === 'intake') {
      payload.intake_type = form.item_name.trim();
      payload.intake_amount = parseFloat(form.quantity);
      payload.intake_unit = form.unit;
    } else {
      payload.output_type = form.item_name.trim();
      payload.output_amount = parseFloat(form.quantity);
      payload.output_unit = form.unit;
    }
    createMutation.mutate(payload);
  };

  const handleDelete = (id: number) => {
    if (!confirm(t('io.confirmDelete', { defaultValue: 'Delete this record?' }))) return;
    deleteMutation.mutate(id);
  };

  return (
    <div className="space-y-4" data-testid="io-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t('drawer.io.title', { defaultValue: 'Intake / Output' })}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => { recordsQuery.refetch(); balanceQuery.refetch(); }} className="btn-ghost p-1.5" aria-label="Refresh" data-testid="io-refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-ghost p-1.5 text-[var(--color-primary)]"
            aria-label="Add record"
            data-testid="add-io-btn"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Fluid Balance Summary */}
      {balanceQuery.data && (
        <div className="grid grid-cols-3 gap-2" data-testid="fluid-balance">
          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-2 text-center">
            <TrendingUp className="w-4 h-4 text-blue-600 mx-auto mb-1" />
            <p className="text-sm font-bold text-blue-600">{balanceQuery.data.total_intake}<span className="text-[10px] font-normal ml-0.5">ml</span></p>
            <p className="text-[10px] text-blue-500">{t('io.intake', { defaultValue: 'Intake' })}</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/30 rounded-lg p-2 text-center">
            <TrendingDown className="w-4 h-4 text-amber-600 mx-auto mb-1" />
            <p className="text-sm font-bold text-amber-600">{balanceQuery.data.total_output}<span className="text-[10px] font-normal ml-0.5">ml</span></p>
            <p className="text-[10px] text-amber-500">{t('io.output', { defaultValue: 'Output' })}</p>
          </div>
          <div className={`rounded-lg p-2 text-center ${balanceQuery.data.balance >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-red-50 dark:bg-red-900/30'}`}>
            <Activity className={`w-4 h-4 mx-auto mb-1 ${balanceQuery.data.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`} />
            <p className={`text-sm font-bold ${balanceQuery.data.balance >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {balanceQuery.data.balance > 0 ? '+' : ''}{balanceQuery.data.balance}<span className="text-[10px] font-normal ml-0.5">ml</span>
            </p>
            <p className={`text-[10px] ${balanceQuery.data.balance >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{t('io.balance', { defaultValue: 'Balance' })}</p>
          </div>
        </div>
      )}

      {/* Quick Add Form */}
      {showForm && (
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30 space-y-3" data-testid="io-form">
          {/* Type Toggle */}
          <div className="grid grid-cols-2 gap-2">
            {(['intake', 'output'] as const).map(type => (
              <button
                key={type}
                onClick={() => setForm(f => ({ ...f, io_type: type }))}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  form.io_type === type
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                    : 'border-[var(--color-border)] hover:border-[var(--color-primary)] text-[var(--color-text-secondary)]'
                }`}
                data-testid={`io-type-${type}`}
              >
                {t(`io.${type}`, { defaultValue: type === 'intake' ? 'Intake' : 'Output' })}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="label text-xs">{t('io.itemName', { defaultValue: 'Item' })} *</label>
              <input
                type="text"
                value={form.item_name}
                onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))}
                placeholder={form.io_type === 'intake' ? t('io.intakePlaceholder', { defaultValue: 'e.g., IV NS, Oral fluids' }) : t('io.outputPlaceholder', { defaultValue: 'e.g., Urine, Emesis' })}
                className="input text-sm"
                data-testid="io-item-input"
              />
            </div>
            <div>
              <label className="label text-xs">{t('io.quantity', { defaultValue: 'Qty (ml)' })} *</label>
              <input
                type="number"
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                className="input text-sm"
                data-testid="io-quantity-input"
              />
            </div>
          </div>

          <div>
            <label className="label text-xs">{t('io.remarks', { defaultValue: 'Remarks' })}</label>
            <input
              type="text"
              value={form.remarks}
              onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
              className="input text-sm"
              data-testid="io-remarks-input"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setForm({ io_type: 'intake', item_name: '', quantity: '', unit: 'ml', remarks: '' }); }} className="btn-secondary text-xs">
              {t('common:cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={createMutation.isPending || !form.item_name.trim() || !form.quantity}
              className="btn-primary text-xs"
              data-testid="save-io-btn"
            >
              {createMutation.isPending ? t('common:saving') : t('common:save')}
            </button>
          </div>
        </div>
      )}

      {/* Records List */}
      <div className="space-y-1.5" data-testid="io-list">
        {recordsQuery.isLoading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-12 w-full rounded-lg" />
          ))
        ) : records.length === 0 ? (
          <div className="text-center py-6 text-[var(--color-text-muted)]" data-testid="io-empty">
            <Droplets className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t('drawer.io.noRecords', { defaultValue: 'No I/O records yet' })}</p>
          </div>
        ) : (
          records.map(r => {
            const isIntake = !!r.intake_type;
            return (
              <div
                key={r.id}
                className="flex items-center gap-3 p-2.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)]/20 transition-colors group"
                data-testid="io-item"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isIntake ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'}`}>
                  {isIntake ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)] truncate">
                    {isIntake ? r.intake_type : r.output_type}
                  </p>
                  <p className="text-[10px] text-[var(--color-text-muted)]">
                    {r.recorded_on ? new Date(r.recorded_on).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    {r.remarks ? ` · ${r.remarks}` : ''}
                  </p>
                </div>
                <span className={`text-sm font-bold flex-shrink-0 ${isIntake ? 'text-blue-600' : 'text-amber-600'}`}>
                  {isIntake ? '+' : '-'}{isIntake ? r.intake_amount : r.output_amount} {isIntake ? r.intake_unit : r.output_unit}
                </span>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="btn-ghost p-1 text-red-500 opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
                  title={t('common:delete')}
                  data-testid="delete-io-btn"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { Plus, Trash2, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import Modal from '../../components/shared/Modal';

interface SalaryHead {
  id: number;
  head_name: string;
  head_type: 'earning' | 'deduction';
  is_taxable: number;
  is_active: number;
}

interface ListResponse<T> { data: T[]; }
interface MessageResponse { message?: string; }

export default function SalaryHeadsTab() {
  const { t } = useTranslation(['hr']);
  const queryClient = useQueryClient();

  const headsQuery = useApiQuery<ListResponse<SalaryHead>>(
    queryKeys.hr.salaryHeads(),
    '/api/hr/payroll/salary-heads',
  );
  const heads = headsQuery.data?.data ?? [];

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SalaryHead | null>(null);
  const [form, setForm] = useState({ headName: '', headType: 'earning' as 'earning' | 'deduction', isTaxable: true });

  const openCreate = () => { setEditing(null); setForm({ headName: '', headType: 'earning', isTaxable: true }); setShowModal(true); };
  const openEdit = (h: SalaryHead) => { setEditing(h); setForm({ headName: h.head_name, headType: h.head_type, isTaxable: h.is_taxable === 1 }); setShowModal(true); };

  const saveMutation = useApiMutation<MessageResponse, typeof form>(
    editing ? 'put' : 'post',
    editing ? `/api/hr/payroll/salary-heads/${editing.id}` : '/api/hr/payroll/salary-heads',
    {
      onSuccess: () => {
        toast.success(t('hr:toasts.salaryHeadCreated'));
        setShowModal(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.salaryHeads() });
      },
      onError: (err) => { toast.error(err.message || t('hr:toasts.failed')); },
    },
  );

  const deleteMutation = useApiMutation<MessageResponse, { id: number }>(
    'delete',
    (vars) => `/api/hr/payroll/salary-heads/${vars.id}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.salaryHeads() });
      },
      onError: (err) => { toast.error(err.message || t('hr:toasts.failed')); },
    },
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-title">{t('hr:payroll.salaryHeads')}</h3>
        <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('hr:payroll.addSalaryHead')}</button>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {(['earning', 'deduction'] as const).map((type) => (
          <div key={type} className="border border-[var(--color-border)] rounded-xl p-4">
            <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${type === 'earning' ? 'text-emerald-600' : 'text-red-600'}`}>
              {t(`hr:payroll.${type}`)}
            </p>
            <div className="space-y-1">
              {heads.filter((h) => h.head_type === type).map((h) => (
                <div key={h.id} className="flex items-center justify-between text-sm py-1 group">
                  <span>{h.head_name}</span>
                  <div className="flex items-center gap-1">
                    {h.is_taxable === 1 && <span className="badge badge-neutral text-xs">{t('hr:payroll.taxable')}</span>}
                    <button onClick={() => openEdit(h)} className="btn-ghost p-1 opacity-0 group-hover:opacity-100" aria-label="Edit">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { if (confirm(`Delete ${h.head_name}?`)) deleteMutation.mutate({ id: h.id }); }} className="btn-ghost p-1 opacity-0 group-hover:opacity-100 text-red-600" aria-label="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {heads.filter((h) => h.head_type === type).length === 0 && (
                <p className="text-[var(--color-text-muted)] text-sm">{t('hr:payroll.empty.noHeads')}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <Modal title={editing ? t('hr:payroll.headName') : t('hr:payroll.addSalaryHead')} onClose={() => setShowModal(false)}>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">{t('hr:payroll.headName')} *</label>
              <input className="input" required value={form.headName} onChange={(e) => setForm((f) => ({ ...f, headName: e.target.value }))} />
            </div>
            <div>
              <label className="label">{t('hr:payroll.headType')}</label>
              <select className="input" value={form.headType} onChange={(e) => setForm((f) => ({ ...f, headType: e.target.value as 'earning' | 'deduction' }))}>
                <option value="earning">{t('hr:payroll.earning')}</option>
                <option value="deduction">{t('hr:payroll.deduction')}</option>
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isTaxable} onChange={(e) => setForm((f) => ({ ...f, isTaxable: e.target.checked }))} />
              <span className="text-sm">{t('hr:payroll.taxable')}</span>
            </label>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">{t('common:cancel')}</button>
              <button type="submit" disabled={saveMutation.isPending} className="btn-primary">
                {saveMutation.isPending ? t('common:saving') : t('common:save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

import { useState } from 'react';
import { Plus, X, Save, Trash2, DollarSign, Percent, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

interface CommissionRule {
  id: number;
  role: string;
  rule_type: string;
  amount: number;
  percent: number;
  procedure_id: number | null;
  department_id: number | null;
  doctor_id: number | null;
  include_emergency_surcharge: number;
  is_active: number;
  priority: number;
}

const ROLES = ['chief_surgeon', 'assistant_surgeon', 'anesthetist', 'anesthetist_assistant'];

export default function CommissionRules({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantBilling']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({
    role: 'chief_surgeon', rule_type: 'percentage_of_surgery',
    amount: '', percent: '', priority: '0',
    include_emergency_surcharge: false,
  });

  const { data, isLoading } = useApiQuery<{ rules: CommissionRule[] }>(
    queryKeys.ot.commissionRules(),
    '/api/ot/commission-rules',
  );
  const rules = data?.rules ?? [];

  const RULE_TYPES = [
    { value: 'fixed_amount', label: t('commissionRules.ruleType.fixedAmount') },
    { value: 'percentage_of_surgery', label: t('commissionRules.ruleType.percentOfSurgery') },
    { value: 'percentage_after_discount', label: t('commissionRules.ruleType.percentAfterDiscount') },
    { value: 'package_based', label: t('commissionRules.ruleType.packageBased') },
    { value: 'department_based', label: t('commissionRules.ruleType.departmentBased') },
    { value: 'doctor_based', label: t('commissionRules.ruleType.doctorBased') },
  ];

  const createMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/ot/commission-rules',
    {
      onSuccess: () => {
        toast.success(t('commissionRules.toast.created'));
        resetForm();
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.commissionRules() });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const updateMutation = useApiMutation<unknown, { id: number; body: Record<string, unknown> }>(
    'put',
    (vars) => `/api/ot/commission-rules/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('commissionRules.toast.updated'));
        resetForm();
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.commissionRules() });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const deleteMutation = useApiMutation<unknown, { id: number }>(
    'delete',
    (vars) => `/api/ot/commission-rules/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('commissionRules.toast.deleted'));
        queryClient.invalidateQueries({ queryKey: queryKeys.ot.commissionRules() });
      },
      onError: (err) => toast.error(err.message || 'Failed'),
    },
  );

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ role: 'chief_surgeon', rule_type: 'percentage_of_surgery', amount: '', percent: '', priority: '0', include_emergency_surcharge: false });
  };

  const startEdit = (rule: CommissionRule) => {
    setEditingId(rule.id);
    setShowForm(true);
    setForm({
      role: rule.role,
      rule_type: rule.rule_type,
      amount: rule.amount ? String(rule.amount) : '',
      percent: rule.percent ? String(rule.percent) : '',
      priority: String(rule.priority),
      include_emergency_surcharge: !!rule.include_emergency_surcharge,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {
      role: form.role,
      rule_type: form.rule_type,
      amount: form.amount ? parseFloat(form.amount) : 0,
      percent: form.percent ? parseFloat(form.percent) : 0,
      priority: parseInt(form.priority) || 0,
      include_emergency_surcharge: form.include_emergency_surcharge ? 1 : 0,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, body });
    } else {
      createMutation.mutate(body);
    }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-lg mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('commissionRules.title')}</h1>
              <p className="section-subtitle">{t('commissionRules.subtitle')}</p>
            </div>
          </div>
          <button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('commissionRules.addRule')}
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">{editingId ? t('commissionRules.form.editTitle') : t('commissionRules.form.newTitle')}</h3>
              <button onClick={resetForm} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="label">{t('commissionRules.form.role')}</label>
                  <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                    {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('commissionRules.form.ruleType')}</label>
                  <select className="input" value={form.rule_type} onChange={e => setForm(f => ({ ...f, rule_type: e.target.value }))}>
                    {RULE_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">{t('commissionRules.form.priority')}</label>
                  <input className="input" type="number" min="0" max="100" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
                </div>
                {form.rule_type === 'fixed_amount' ? (
                  <div>
                    <label className="label">{t('commissionRules.form.amount')}</label>
                    <input className="input" type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                  </div>
                ) : (
                  <div>
                    <label className="label">{t('commissionRules.form.percent')}</label>
                    <input className="input" type="number" step="0.01" min="0" max="100" value={form.percent} onChange={e => setForm(f => ({ ...f, percent: e.target.value }))} />
                  </div>
                )}
                <div className="flex items-end">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={form.include_emergency_surcharge} onChange={e => setForm(f => ({ ...f, include_emergency_surcharge: e.target.checked }))} />
                    <span className="text-sm">{t('commissionRules.form.includeEmergencySurcharge')}</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={resetForm} className="btn-secondary">{t('commissionRules.form.cancel')}</button>
                <button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="btn-primary">
                  {(createMutation.isPending || updateMutation.isPending) ? t('commissionRules.form.saving') : editingId ? t('commissionRules.form.update') : t('commissionRules.form.create')}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Rules List */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-16 w-full rounded-xl" />)}
          </div>
        ) : rules.length === 0 ? (
          <EmptyState
            icon={<DollarSign className="w-8 h-8 text-[var(--color-text-muted)]" />}
            title={t('commissionRules.empty.title')}
            description={t('commissionRules.empty.description')}
            action={
              <button onClick={() => setShowForm(true)} className="btn-primary mt-2">
                <Plus className="w-4 h-4" /> {t('commissionRules.addFirstRule')}
              </button>
            }
          />
        ) : (
          <div className="card overflow-hidden">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('commissionRules.column.role')}</th>
                  <th>{t('commissionRules.column.ruleType')}</th>
                  <th>{t('commissionRules.column.amountOrPercent')}</th>
                  <th>{t('commissionRules.column.priority')}</th>
                  <th>{t('commissionRules.column.emergency')}</th>
                  <th>{t('commissionRules.column.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.id}>
                    <td className="capitalize font-medium">{rule.role.replace(/_/g, ' ')}</td>
                    <td className="capitalize">{rule.rule_type.replace(/_/g, ' ')}</td>
                    <td className="font-data">
                      {rule.rule_type === 'fixed_amount'
                        ? `৳${rule.amount.toLocaleString()}`
                        : `${rule.percent}%`}
                    </td>
                    <td className="font-data">{rule.priority}</td>
                    <td>{rule.include_emergency_surcharge ? t('commissionRules.yes') : t('commissionRules.no')}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => startEdit(rule)} className="btn-ghost p-1.5" title={t('commissionRules.edit')}>
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => deleteMutation.mutate({ id: rule.id })} className="btn-ghost p-1.5 text-red-500" title={t('commissionRules.delete')}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

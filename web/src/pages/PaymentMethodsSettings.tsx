import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, Search, Edit2, Save, X, CreditCard, Check, XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface PaymentMethod {
  id: number;
  name: string;
  code: string;
  active: boolean;
  transaction_id_required: boolean;
  charge_applicable: boolean;
}

// ─── Form Component ─────────────────────────────────────────────────────────────

function PaymentMethodForm({ method, onSave, onCancel, saving }: {
  method?: PaymentMethod | null;
  onSave: (data: Omit<PaymentMethod, 'id'> & { id?: number }) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const { t } = useTranslation('settings');
  const [name, setName] = useState(method?.name ?? '');
  const [code, setCode] = useState(method?.code ?? '');
  const [active, setActive] = useState(method?.active ?? true);
  const [txnIdRequired, setTxnIdRequired] = useState(method?.transaction_id_required ?? false);
  const [chargeApplicable, setChargeApplicable] = useState(method?.charge_applicable ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Required';
    if (!code.trim()) newErrors.code = 'Required';
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    onSave({
      ...(method?.id ? { id: method.id } : {}),
      name: name.trim(),
      code: code.trim().toLowerCase().replace(/\s+/g, '_'),
      active,
      transaction_id_required: txnIdRequired,
      charge_applicable: chargeApplicable,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="card p-5 space-y-4">
      <h3 className="section-title">
        {method ? 'Edit Payment Method' : 'Add Payment Method'}
      </h3>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="method-name" className="label">Method Name *</label>
          <input id="method-name" aria-label="Method Name" type="text" className="input" value={name}
            onChange={e => { setName(e.target.value); setErrors(prev => ({ ...prev, name: '' })); }}
            placeholder="e.g. bKash" />
          {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="method-code" className="label">Code *</label>
          <input id="method-code" aria-label="Code" type="text" className="input" value={code}
            onChange={e => { setCode(e.target.value); setErrors(prev => ({ ...prev, code: '' })); }}
            placeholder="e.g. bkash" />
          {errors.code && <p className="mt-1 text-xs text-red-500">{errors.code}</p>}
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
          <span className="text-sm text-[var(--color-text-secondary)]">Active</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={txnIdRequired} onChange={e => setTxnIdRequired(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
          <span className="text-sm text-[var(--color-text-secondary)]">Transaction ID Required</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={chargeApplicable} onChange={e => setChargeApplicable(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
          <span className="text-sm text-[var(--color-text-secondary)]">Charge Applicable</span>
        </label>
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-border)]">
        <button type="submit" disabled={saving} className="btn-primary">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          <X className="w-4 h-4" /> Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function PaymentMethodsSettings({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [showForm, setShowForm] = useState(false);

  // ── Fetch methods ──
  const { data, isLoading } = useApiQuery<{ methods: PaymentMethod[] }>(
    ['payment-methods'],
    '/api/payment-methods',
  );

  const methods = data?.methods ?? [];

  // ── Save mutation ──
  const saveMutation = useApiMutation<unknown, Omit<PaymentMethod, 'id'> & { id?: number }>(
    'post',
    '/api/payment-methods',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
        setShowForm(false);
        setEditingMethod(null);
        toast.success('Payment method saved');
      },
      onError: () => toast.error('Failed to save payment method'),
    },
  );

  // ── Toggle mutation ──
  const toggleMutation = useApiMutation<unknown, { id: number; active: boolean }>(
    'put',
    '/api/payment-methods',
    {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payment-methods'] }),
    },
  );

  // ── Filter ──
  const filtered = useMemo(() => {
    if (!search.trim()) return methods;
    const q = search.toLowerCase();
    return methods.filter(m => m.name.toLowerCase().includes(q) || m.code.includes(q));
  }, [methods, search]);

  return (
    <DashboardLayout role={role}>
      <div className="max-w-4xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="page-title">Payment Methods</h1>
            <p className="section-subtitle mt-1">Configure cash, mobile banking, card, and bank transfer options</p>
          </div>
          <button onClick={() => { setEditingMethod(null); setShowForm(true); }}
            aria-label="Add Payment Method" className="btn-primary">
            <Plus className="w-4 h-4" /> Add Payment Method
          </button>
        </div>

        {/* ── Search ── */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search methods..." className="input pl-10" aria-label="Search methods" />
        </div>

        {/* ── Form ── */}
        {showForm && (
          <PaymentMethodForm
            method={editingMethod}
            onSave={data => saveMutation.mutate(data)}
            onCancel={() => { setShowForm(false); setEditingMethod(null); }}
            saving={saveMutation.isPending}
          />
        )}

        {/* ── Table ── */}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} data-testid="skeleton" className="skeleton h-12 w-full rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-8 text-center">
            <CreditCard className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-3" />
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">No payment methods found</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Code</th>
                    <th>Status</th>
                    <th>Txn ID</th>
                    <th>Charge</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(method => (
                    <tr key={method.id}>
                      <td className="font-medium">{method.name}</td>
                      <td className="font-data text-sm">{method.code}</td>
                      <td>
                        <button
                          role="switch"
                          aria-label={`${method.name} active`}
                          aria-checked={method.active}
                          onClick={() => toggleMutation.mutate({ id: method.id, active: !method.active })}
                          className={`relative w-10 h-6 rounded-full transition-colors ${method.active ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`}
                        >
                          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${method.active ? 'right-1' : 'left-1'}`} />
                        </button>
                      </td>
                      <td>
                        {method.transaction_id_required ? (
                          <span className="badge-warning">Required</span>
                        ) : (
                          <span className="badge-neutral">Optional</span>
                        )}
                      </td>
                      <td>
                        {method.charge_applicable ? (
                          <span className="badge-info">Yes</span>
                        ) : (
                          <span className="badge-neutral">No</span>
                        )}
                      </td>
                      <td>
                        <div className="flex items-center justify-end">
                          <button onClick={() => { setEditingMethod(method); setShowForm(true); }}
                            aria-label="edit"
                            className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] rounded-lg transition-colors">
                            <Edit2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

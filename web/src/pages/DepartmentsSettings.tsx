import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, Search, Edit2, CheckCircle, XCircle, Save, X, Layers,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface Department {
  id: number;
  name: string;
  code: string;
  opd: boolean;
  ipd: boolean;
  status: 'active' | 'inactive';
}

// ─── Form Component ─────────────────────────────────────────────────────────────

interface DepartmentFormProps {
  department?: Department | null;
  onSave: (data: Omit<Department, 'id'> & { id?: number }) => void;
  onCancel: () => void;
  saving?: boolean;
}

function DepartmentForm({ department, onSave, onCancel, saving }: DepartmentFormProps) {
  const { t } = useTranslation('settings');
  const [name, setName] = useState(department?.name ?? '');
  const [code, setCode] = useState(department?.code ?? '');
  const [opd, setOpd] = useState(department?.opd ?? false);
  const [ipd, setIpd] = useState(department?.ipd ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = t('required', { defaultValue: 'Required' });
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    onSave({
      ...(department?.id ? { id: department.id } : {}),
      name: name.trim(),
      code: code.trim().toUpperCase(),
      opd,
      ipd,
      status: 'active',
    });
  };

  return (
    <form onSubmit={handleSubmit} className="card p-5 space-y-4">
      <h3 className="section-title">
        {department ? t('editDepartment', { defaultValue: 'Edit Department' }) : t('addDepartment', { defaultValue: 'Add Department' })}
      </h3>

      <div>
        <label htmlFor="dept-name" className="label">{t('departmentName', { defaultValue: 'Department Name' })} *</label>
        <input id="dept-name" aria-label={t('departmentName', { defaultValue: 'Department Name' })} type="text" className="input" value={name}
          onChange={e => { setName(e.target.value); setErrors(prev => ({ ...prev, name: '' })); }}
          placeholder={t('departmentNamePlaceholder', { defaultValue: 'e.g. Cardiology' })} />
        {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name}</p>}
      </div>

      <div>
        <label htmlFor="dept-code" className="label">{t('departmentCode', { defaultValue: 'Department Code' })}</label>
        <input id="dept-code" aria-label={t('departmentCode', { defaultValue: 'Department Code' })} type="text" className="input" value={code}
          onChange={e => setCode(e.target.value)}
          placeholder={t('departmentCodePlaceholder', { defaultValue: 'e.g. CAR' })} />
      </div>

      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" aria-label="OPD" checked={opd} onChange={e => setOpd(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
          <span className="text-sm text-[var(--color-text-secondary)]">OPD</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" aria-label="IPD" checked={ipd} onChange={e => setIpd(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
          <span className="text-sm text-[var(--color-text-secondary)]">IPD</span>
        </label>
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-border)]">
        <button type="submit" disabled={saving} className="btn-primary">
          <Save className="w-4 h-4" /> {saving ? t('saving', { defaultValue: 'Saving...' }) : t('save', { defaultValue: 'Save' })}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          <X className="w-4 h-4" /> {t('cancel', { defaultValue: 'Cancel' })}
        </button>
      </div>
    </form>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function DepartmentsSettings({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [showForm, setShowForm] = useState(false);

  // ── Fetch departments ──
  const { data, isLoading } = useApiQuery<{ departments: Department[] }>(
    ['departments'],
    '/api/departments',
  );

  const departments = data?.departments ?? [];

  // ── Create/Update mutation ──
  const saveMutation = useApiMutation<unknown, Omit<Department, 'id'> & { id?: number }>(
    'post',
    '/api/departments',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['departments'] });
        setShowForm(false);
        setEditingDept(null);
      },
    },
  );

  // ── Status toggle mutation ──
  const statusMutation = useApiMutation<unknown, { id: number; status: string }>(
    'put',
    '/api/departments',
    {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['departments'] }),
    },
  );

  // ── Filter by search ──
  const filtered = useMemo(() => {
    if (!search.trim()) return departments;
    const q = search.toLowerCase();
    return departments.filter(d =>
      d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q)
    );
  }, [departments, search]);

  // ── Handlers ──
  const handleSave = (data: Omit<Department, 'id'> & { id?: number }) => {
    saveMutation.mutate(data);
  };

  const handleToggleStatus = (dept: Department) => {
    statusMutation.mutate({ id: dept.id, status: dept.status === 'active' ? 'inactive' : 'active' });
  };

  const handleEdit = (dept: Department) => {
    setEditingDept(dept);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingDept(null);
  };

  return (
    <DashboardLayout role={role}>
      <div className="max-w-4xl mx-auto space-y-5">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="page-title">{t('departments', { defaultValue: 'Departments' })}</h1>
            <p className="section-subtitle mt-1">
              {t('departmentsDesc', { defaultValue: 'Manage OPD/IPD departments — inactive instead of delete to preserve history' })}
            </p>
          </div>
          <button
            onClick={() => { setEditingDept(null); setShowForm(true); }}
            aria-label={t('addDepartment', { defaultValue: 'Add Department' })}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />
            {t('addDepartment', { defaultValue: 'Add Department' })}
          </button>
        </div>

        {/* ── Search ── */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('searchDepartments', { defaultValue: 'Search departments...' })}
            className="input pl-10"
            aria-label={t('searchDepartments', { defaultValue: 'Search departments' })}
          />
        </div>

        {/* ── Form (inline) ── */}
        {showForm && (
          <DepartmentForm
            department={editingDept}
            onSave={handleSave}
            onCancel={handleCancel}
            saving={saveMutation.isPending}
          />
        )}

        {/* ── Department Table ── */}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} data-testid="skeleton" className="skeleton h-12 w-full rounded-lg" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-8 text-center">
            <Layers className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-3" />
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">
              {t('noDepartments', { defaultValue: 'No departments found' })}
            </p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('department', { defaultValue: 'Department' })}</th>
                    <th>{t('code', { defaultValue: 'Code' })}</th>
                    <th>OPD</th>
                    <th>IPD</th>
                    <th>{t('status', { defaultValue: 'Status' })}</th>
                    <th className="text-right">{t('actions', { defaultValue: 'Actions' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(dept => (
                    <tr key={dept.id}>
                      <td className="font-medium">{dept.name}</td>
                      <td className="font-data text-sm">{dept.code}</td>
                      <td>
                        <span className={dept.opd ? 'badge-success' : 'badge-neutral'}>
                          {dept.opd ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td>
                        <span className={dept.ipd ? 'badge-success' : 'badge-neutral'}>
                          {dept.ipd ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td>
                        <span className={dept.status === 'active' ? 'badge-success' : 'badge-warning'}>
                          {dept.status}
                        </span>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleEdit(dept)}
                            aria-label="edit"
                            className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggleStatus(dept)}
                            aria-label={dept.status === 'active' ? 'deactivate' : 'activate'}
                            className={`p-1.5 rounded-lg transition-colors ${
                              dept.status === 'active'
                                ? 'text-[var(--color-text-muted)] hover:text-amber-600 hover:bg-amber-50'
                                : 'text-[var(--color-text-muted)] hover:text-emerald-600 hover:bg-emerald-50'
                            }`}
                            title={dept.status === 'active' ? 'Deactivate' : 'Activate'}
                          >
                            {dept.status === 'active' ? <XCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
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

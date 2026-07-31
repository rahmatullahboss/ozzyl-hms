import { useState, useEffect } from 'react';
import { Settings, Plus, X, Trash2, Edit2, Tag, Layers, Package, Calendar, Building2, CreditCard, ChevronLeft, ChevronRight, Award, Wallet, Monitor, Hospital } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/apiClient';
import { getTodayGMT6 } from '../lib/date-utils';

/* ───── Shared types ────────────────────────────────────── */
interface Scheme { id: number; scheme_name: string; scheme_code?: string; scheme_type: string; default_discount_percent: number; default_price_category_id?: number | null; default_discount_source?: string | null; valid_from?: string | null; valid_to?: string | null; max_discount_amount_per_bill?: number; max_discount_amount_per_month?: number; max_discount_amount_per_year?: number; approval_required_over_percent?: number; requires_reference?: boolean; is_auto_apply?: boolean; is_active: boolean; }
interface SchemeMember { id: number; patient_id?: number | null; member_code?: string | null; member_name?: string | null; relation?: string | null; valid_from?: string | null; valid_to?: string | null; status?: string | null; }
interface PriceCategory { id: number; category_name: string; category_code?: string; is_default: boolean; is_active: boolean; }
interface ServiceDept { id: number; department_name: string; department_code?: string; is_active: boolean; }
interface ServiceItem { id: number; item_name: string; item_code?: string; price: number; allow_discount: boolean; tax_applicable: boolean; tax_percent: number; is_active: boolean; service_department_id?: number | null; department_name?: string | null; description?: string | null; is_commissionable?: boolean | number | string | null; }
interface PerformerPayoutRule { id: number; diagnostic_kind: 'lab' | 'radiology'; rate_type: 'flat' | 'percent'; flat_amount: number | null; percent: number | null; effective_from: string; effective_to?: string | null; notes: string | null; enabled: boolean; }
interface PerformerPayoutRuleResponse { current: PerformerPayoutRule | null; history: PerformerPayoutRule[]; }
interface FiscalYear { id: number; fiscal_year_name: string; start_date: string; end_date: string; is_current: boolean; is_active: boolean; }
interface CreditOrg { id: number; organization_name: string; organization_code?: string; contact_person?: string; contact_no?: string; email?: string; credit_limit: number; is_active: boolean; }
interface BillingPackage { id: number; package_name: string; package_code?: string; description?: string; total_price: number; discount_percent: number; is_active: boolean; package_type?: 'standard' | 'package_plus_bed' | 'package_included_days'; included_bed_days?: number; extra_bed_rate?: number; }
interface MembershipType { id: number; membership_name: string; membership_code?: string; discount_percent: number; description?: string; is_active: boolean; }
interface DepositHead { id: number; head_name: string; head_code?: string; description?: string; is_active: boolean; }
interface BillingMasterHealthIssue { key: string; label: string; count: number; severity: 'critical' | 'warning' | string; tab: string; }
interface BillingMasterHealthCheck {
  summary: Record<string, number>;
  issues: BillingMasterHealthIssue[];
  health_score: number;
}
interface PriceMatrixCategory { id: number; category_name: string; category_code?: string | null; is_default: boolean; }
interface PriceMatrixCell { price_category_id: number; mapping_id?: number | null; price: number; is_discount_applicable: boolean; inherited_from_base: boolean; }
interface PriceMatrixRow { service_item_id: number; item_name: string; item_code?: string | null; department_name?: string | null; base_price: number; allow_discount: boolean; prices: PriceMatrixCell[]; }
interface PriceMatrixResponse { categories: PriceMatrixCategory[]; rows: PriceMatrixRow[]; }

const PAGE_SIZE = 25;

const TABS = [
  { key: 'overview',     label: 'Overview',       icon: Settings  },
  { key: 'schemes',      label: 'Schemes',        icon: Tag       },
  { key: 'categories',   label: 'Price Categories',icon: Layers    },
  { key: 'priceMatrix',  label: 'Price Matrix',    icon: Layers    },
  { key: 'departments',  label: 'Service Depts',   icon: Building2 },
  { key: 'items',        label: 'Service Items',   icon: CreditCard},
  { key: 'fiscal',       label: 'Fiscal Years',    icon: Calendar  },
  { key: 'credit',       label: 'Credit Orgs',     icon: Building2 },
  { key: 'packages',     label: 'Packages',        icon: Package   },
  { key: 'memberships',  label: 'Memberships',     icon: Award     },
  { key: 'deposits',     label: 'Deposit Heads',   icon: Wallet   },
  { key: 'bedPolicy',    label: 'Bed Charge Policy', icon: Settings },
  { key: 'counters',     label: 'Counters',        icon: Monitor   },
  { key: 'referralHospitals', label: 'Referral Hospitals', icon: Hospital },
] as const;

/* ───── Shared components ────────────────────────────────── */
function SkeletonRows({ cols }: { cols: number }) {
  return <>{[...Array(4)].map((_, i) => <tr key={i}>{[...Array(cols)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)}</>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const { t } = useTranslation('billing');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between p-3 border-t border-[var(--color-border)]">
      <span className="text-sm text-[var(--color-text-muted)]">{t('master.common.records', { total, page, totalPages })}</span>
      <div className="flex gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} className="btn-ghost p-1.5 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
        <button onClick={() => onPage(page + 1)} disabled={page >= totalPages} className="btn-ghost p-1.5 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

/* ───── Overview / Health Check ─────────────────────────── */
function OverviewTab({ onJump }: { onJump: (tab: string) => void }) {
  const { data, isLoading } = useApiQuery<{ data: BillingMasterHealthCheck }>(
    ['billing-master', 'health-check'],
    '/api/billing-master/health-check',
  );
  const health = data?.data;
  const summary = health?.summary ?? {};
  const issues = health?.issues ?? [];
  const activeIssues = issues.filter(issue => Number(issue.count) > 0);
  const score = Number(health?.health_score ?? 0);
  const scoreTone = score >= 85 ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : score >= 60 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-red-700 bg-red-50 border-red-200';
  const summaryCards = [
    ['Active service items', summary.active_service_items ?? 0, 'items'],
    ['Active schemes', summary.active_schemes ?? 0, 'schemes'],
    ['Active packages', summary.active_packages ?? 0, 'packages'],
    ['Credit orgs', summary.active_credit_organizations ?? 0, 'credit'],
    ['Counters', summary.active_counters ?? 0, 'counters'],
    ['Deposit heads', summary.active_deposit_heads ?? 0, 'deposits'],
  ] as const;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={`card p-5 border ${scoreTone}`}>
          <div className="text-sm font-medium opacity-80">Billing Master Health</div>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-4xl font-bold font-data">{isLoading ? '—' : score}</span>
            <span className="pb-1 text-sm">/ 100</span>
          </div>
          <p className="mt-2 text-xs opacity-80">Detects duplicate codes, missing department/price mapping, package setup gaps, scheme source gaps, and fiscal-year setup.</p>
        </div>
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">Configuration health check</h3>
              <p className="text-sm text-[var(--color-text-muted)]">Enterprise billing master should block unsafe setup before it reaches reception billing.</p>
            </div>
            <span className={`badge ${activeIssues.length ? 'badge-warning' : 'badge-success'}`}>{activeIssues.length} issue groups</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
            {summaryCards.map(([label, value, tab]) => (
              <button key={label} type="button" onClick={() => onJump(tab)} className="rounded-xl border border-[var(--color-border)] p-3 text-left hover:border-[var(--color-primary)] transition">
                <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
                <div className="text-xl font-semibold font-data mt-1">{Number(value).toLocaleString()}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <div>
            <h3 className="font-semibold">Actionable setup issues</h3>
            <p className="text-sm text-[var(--color-text-muted)]">Fix these before activating enterprise billing rules.</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Issue</th><th>Severity</th><th>Count</th><th>Fix area</th><th></th></tr></thead>
            <tbody>
              {isLoading ? <SkeletonRows cols={5} /> : activeIssues.length === 0 ? (
                <tr><td colSpan={5}><EmptyState icon={<Settings className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No blocking setup issues" description="Billing Master health check did not find critical setup gaps." /></td></tr>
              ) : activeIssues.map(issue => (
                <tr key={issue.key}>
                  <td className="font-medium">{issue.label}</td>
                  <td><span className={`badge ${issue.severity === 'critical' ? 'badge-danger' : 'badge-warning'}`}>{issue.severity}</span></td>
                  <td className="font-data">{Number(issue.count).toLocaleString()}</td>
                  <td className="capitalize">{issue.tab}</td>
                  <td><button type="button" onClick={() => onJump(issue.tab)} className="btn-ghost text-[var(--color-primary)]">Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ───── Schemes ─────────────────────────────────────────── */
const SCHEME_INIT = { scheme_name: '', scheme_code: '', scheme_type: 'general', default_discount_percent: '0', default_price_category_id: '', default_discount_source: 'hospital_discount', valid_from: '', valid_to: '', max_discount_amount_per_bill: '0', max_discount_amount_per_month: '0', max_discount_amount_per_year: '0', approval_required_over_percent: '0', requires_reference: false, is_auto_apply: false };
const DISCOUNT_SOURCE_OPTIONS = [
  ['hospital_discount', 'Hospital discount'],
  ['staff_benefit_discount', 'Staff benefit'],
  ['vip_benefit_discount', 'VIP benefit'],
  ['owner_benefit_discount', 'Owner benefit'],
  ['shareholder_benefit_discount', 'Shareholder benefit'],
  ['corporate_contract_discount', 'Corporate contract'],
  ['charity_discount', 'Charity'],
  ['management_discount', 'Management approval'],
  ['reference_discount', 'Reference discount'],
  ['campaign_discount', 'Campaign'],
] as const;

function sourceLabel(source?: string | null) {
  return DISCOUNT_SOURCE_OPTIONS.find(([value]) => value === source)?.[1] ?? 'Hospital discount';
}

function SchemesTab() {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showPolicyOptions, setShowPolicyOptions] = useState(false);
  const [memberScheme, setMemberScheme] = useState<Scheme | null>(null);
  const [memberEditId, setMemberEditId] = useState<number | null>(null);
  const [memberForm, setMemberForm] = useState({ member_code: '', member_name: '', patient_id: '', relation: 'self', valid_from: '', valid_to: '', status: 'active' });
  const [form, setForm] = useState(SCHEME_INIT);

  const { data: priceCategoryData } = useApiQuery<{ data: PriceCategory[]; total?: number }>(
    ['billing-master', 'scheme-form-price-categories'],
    '/api/billing-master/price-categories',
    { staleTime: 30 * 60_000 },
  );

  const { data, isLoading: loading } = useApiQuery<{ data: Scheme[]; total: number }>(
    queryKeys.billingMaster.schemes(page),
    `/api/billing-master/schemes?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
  );

  const items = data?.data ?? [];
  const total = data?.total ?? items.length;
  const memberPath = '/api/billing-master/schemes/' + (memberScheme?.id ?? 0) + '/members';
  const { data: memberData, isLoading: membersLoading } = useApiQuery<{ data: SchemeMember[] }>(['billing-master', 'scheme-members', memberScheme?.id ?? 0], memberPath, { enabled: Boolean(memberScheme?.id) });
  const schemeMembers = memberData?.data ?? [];

  const saveMutation = useApiMutation<unknown, Record<string, unknown>>(
    editId ? 'put' : 'post',
    editId ? `/api/billing-master/schemes/${editId}` : '/api/billing-master/schemes',
    {
      onSuccess: () => {
        toast.success(editId ? t('master.schemes.schemeUpdated') : t('master.schemes.schemeCreated'));
        setShowForm(false); setForm(SCHEME_INIT); setEditId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const saveMemberMutation = useApiMutation<unknown, Record<string, unknown>>(
    memberEditId ? 'put' : 'post',
    (vars) => memberEditId ? '/api/billing-master/scheme-members/' + String(vars.memberId) : '/api/billing-master/schemes/' + String(vars.schemeId) + '/members',
    {
      onSuccess: () => {
        toast.success(memberEditId ? 'Scheme member updated' : 'Scheme member saved');
        setMemberEditId(null);
        setMemberForm({ member_code: '', member_name: '', patient_id: '', relation: 'self', valid_from: '', valid_to: '', status: 'active' });
        queryClient.invalidateQueries({ queryKey: ['billing-master', 'scheme-members', memberScheme?.id ?? 0] });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const deleteMemberMutation = useApiMutation<unknown, number>(
    'delete',
    (id) => '/api/billing-master/scheme-members/' + id,
    {
      onSuccess: () => {
        toast.success('Scheme member deactivated');
        queryClient.invalidateQueries({ queryKey: ['billing-master', 'scheme-members', memberScheme?.id ?? 0] });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const deleteMutation = useApiMutation<unknown, number>(
    'delete',
    (id) => `/api/billing-master/schemes/${id}`,
    {
      onSuccess: () => {
        toast.success(t('master.common.deactivated'));
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const openEdit = (s: Scheme) => {
    setEditId(s.id);
    setShowPolicyOptions(false);
    setForm({ scheme_name: s.scheme_name, scheme_code: s.scheme_code ?? '', scheme_type: s.scheme_type, default_discount_percent: String(s.default_discount_percent), default_price_category_id: s.default_price_category_id ? String(s.default_price_category_id) : '', default_discount_source: s.default_discount_source ?? 'hospital_discount', valid_from: s.valid_from ?? '', valid_to: s.valid_to ?? '', max_discount_amount_per_bill: String(s.max_discount_amount_per_bill ?? 0), max_discount_amount_per_month: String(s.max_discount_amount_per_month ?? 0), max_discount_amount_per_year: String(s.max_discount_amount_per_year ?? 0), approval_required_over_percent: String(s.approval_required_over_percent ?? 0), requires_reference: Boolean(s.requires_reference), is_auto_apply: Boolean(s.is_auto_apply) });
    setShowForm(true);
  };

  const openCreate = () => { setEditId(null); setShowPolicyOptions(false); setForm(SCHEME_INIT); setShowForm(true); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...form, default_discount_percent: parseFloat(form.default_discount_percent) || 0, default_price_category_id: form.default_price_category_id ? Number(form.default_price_category_id) : null, max_discount_amount_per_bill: parseFloat(form.max_discount_amount_per_bill) || 0, max_discount_amount_per_month: parseFloat(form.max_discount_amount_per_month) || 0, max_discount_amount_per_year: parseFloat(form.max_discount_amount_per_year) || 0, approval_required_over_percent: parseFloat(form.approval_required_over_percent) || 0, valid_from: form.valid_from || null, valid_to: form.valid_to || null };
    saveMutation.mutate(payload);
  };

  const handleDelete = (id: number) => {
    if (!confirm(t('master.common.deactivate'))) return;
    deleteMutation.mutate(id);
  };

  const handleSaveMember = (event: React.FormEvent) => {
    event.preventDefault();
    if (!memberScheme) return;
    saveMemberMutation.mutate({
      schemeId: memberScheme.id,
      memberId: memberEditId,
      member_code: memberForm.member_code || null,
      member_name: memberForm.member_name || null,
      patient_id: memberForm.patient_id ? Number(memberForm.patient_id) : null,
      relation: memberForm.relation || null,
      valid_from: memberForm.valid_from || null,
      valid_to: memberForm.valid_to || null,
      status: memberForm.status || 'active',
    });
  };

  const editMember = (member: SchemeMember) => {
    setMemberEditId(member.id);
    setMemberForm({
      member_code: member.member_code ?? '',
      member_name: member.member_name ?? '',
      patient_id: member.patient_id ? String(member.patient_id) : '',
      relation: member.relation ?? 'self',
      valid_from: member.valid_from ?? '',
      valid_to: member.valid_to ?? '',
      status: member.status ?? 'active',
    });
  };

  const cancelMemberEdit = () => {
    setMemberEditId(null);
    setMemberForm({ member_code: '', member_name: '', patient_id: '', relation: 'self', valid_from: '', valid_to: '', status: 'active' });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.schemes.newScheme')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.schemes.schemeName')}</th><th>{t('master.schemes.code')}</th><th>{t('master.schemes.type')}</th><th>{t('master.schemes.discountPercent')}</th><th>Caps</th><th>{t('master.schemes.status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={7} />
            : items.length === 0 ? <tr><td colSpan={7}><EmptyState icon={<Tag className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.schemes.noSchemes')} description={t('master.schemes.noSchemesDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.schemes.newScheme')}</button>} /></td></tr>
            : items.map(s => <tr key={s.id}><td className="font-medium">{s.scheme_name}</td><td className="font-data text-sm">{s.scheme_code ?? '—'}</td><td><span className="badge badge-info capitalize">{s.scheme_type}</span></td><td className="font-data">{s.default_discount_percent}%</td><td className="text-xs text-[var(--color-text-muted)]"><div>Bill ৳{Number(s.max_discount_amount_per_bill ?? 0)}</div><div>Month ৳{Number(s.max_discount_amount_per_month ?? 0)}</div><div>Year ৳{Number(s.max_discount_amount_per_year ?? 0)}</div></td><td><span className={`badge ${s.is_active ? 'badge-success' : 'badge-warning'}`}>{s.is_active ? t('master.schemes.active') : t('master.schemes.inactive')}</span></td><td><div className="flex gap-1"><button onClick={() => openEdit(s)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button><button onClick={() => setMemberScheme(s)} className="btn-ghost px-2 py-1 text-xs text-[var(--color-primary)]">Members</button><button onClick={() => handleDelete(s.id)} className="btn-ghost p-1.5 text-red-500"><Trash2 className="w-4 h-4" /></button></div></td></tr>)}
        </tbody>
      </table></div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
      {showForm && <Modal title={editId ? t('master.schemes.editScheme') : t('master.schemes.newSchemeTitle')} onClose={() => { setShowForm(false); setEditId(null); setShowPolicyOptions(false); setForm(SCHEME_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('master.schemes.schemeNameLabel')}</label><input className="input" required value={form.scheme_name} onChange={e => setForm(f => ({ ...f, scheme_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('master.schemes.code')}</label><input className="input" value={form.scheme_code} onChange={e => setForm(f => ({ ...f, scheme_code: e.target.value }))} /></div>
            <div><label className="label">{t('master.schemes.discountPercent')}</label><input className="input" type="number" min="0" max="100" step="0.1" value={form.default_discount_percent} onChange={e => setForm(f => ({ ...f, default_discount_percent: e.target.value }))} /></div>
          </div>
          <div><label className="label">{t('master.schemes.typeLabel')}</label><select className="input" value={form.scheme_type} onChange={e => setForm(f => ({ ...f, scheme_type: e.target.value }))}><option value="general">{t('master.schemes.general')}</option><option value="insurance">{t('master.schemes.insurance')}</option><option value="government">{t('master.schemes.government')}</option><option value="corporate">{t('master.schemes.corporate')}</option><option value="staff">Staff benefit</option><option value="vip">VIP benefit</option><option value="owner">Owner benefit</option><option value="shareholder">Shareholder benefit</option><option value="charity">Charity</option><option value="campaign">Campaign</option></select></div>
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
            <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setShowPolicyOptions(value => !value)}>
              <span><span className="block text-sm font-semibold">Policy / benefit rules</span><span className="block text-xs text-[var(--color-text-muted)]">{sourceLabel(form.default_discount_source)} · bill cap ৳{form.max_discount_amount_per_bill || '0'} · month ৳{form.max_discount_amount_per_month || '0'} · year ৳{form.max_discount_amount_per_year || '0'} · approval over {form.approval_required_over_percent || '0'}%</span></span>
              <span className="text-xs text-[var(--color-primary)]">{showPolicyOptions ? 'Hide' : 'Advanced'}</span>
            </button>
            {showPolicyOptions && <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div><label className="label">Discount source</label><select className="input" value={form.default_discount_source} onChange={e => setForm(f => ({ ...f, default_discount_source: e.target.value }))}>{DISCOUNT_SOURCE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              <div><label className="label">Default price category</label><select className="input" value={form.default_price_category_id} onChange={e => setForm(f => ({ ...f, default_price_category_id: e.target.value }))}><option value="">No automatic price category</option>{priceCategoryData?.data?.map(category => <option key={category.id} value={category.id}>{category.category_name}{category.is_default ? ' (default)' : ''}</option>)}</select></div>
              <div><label className="label">Valid from</label><input className="input" type="date" value={form.valid_from} onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))} /></div>
              <div><label className="label">Valid to</label><input className="input" type="date" value={form.valid_to} onChange={e => setForm(f => ({ ...f, valid_to: e.target.value }))} /></div>
              <div><label className="label">Max discount per bill</label><input className="input" type="number" min="0" value={form.max_discount_amount_per_bill} onChange={e => setForm(f => ({ ...f, max_discount_amount_per_bill: e.target.value }))} /></div><div><label className="label">Max discount per month</label><input className="input" type="number" min="0" value={form.max_discount_amount_per_month} onChange={e => setForm(f => ({ ...f, max_discount_amount_per_month: e.target.value }))} /></div><div><label className="label">Max discount per year</label><input className="input" type="number" min="0" value={form.max_discount_amount_per_year} onChange={e => setForm(f => ({ ...f, max_discount_amount_per_year: e.target.value }))} /></div>
              <div><label className="label">Approval required over %</label><input className="input" type="number" min="0" max="100" value={form.approval_required_over_percent} onChange={e => setForm(f => ({ ...f, approval_required_over_percent: e.target.value }))} /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.requires_reference} onChange={e => setForm(f => ({ ...f, requires_reference: e.target.checked }))} />Requires reference/note</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_auto_apply} onChange={e => setForm(f => ({ ...f, is_auto_apply: e.target.checked }))} />Auto-suggest in billing</label>
            </div>}
          </div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(SCHEME_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button><button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button></div>
        </form>
      </Modal>}
      {memberScheme && <Modal title={`Scheme members — ${memberScheme.scheme_name}`} onClose={() => setMemberScheme(null)}>
        <div className="p-5 space-y-4">
          <form onSubmit={handleSaveMember} className="grid gap-3 md:grid-cols-3">
            <input className="input" placeholder="Member code" value={memberForm.member_code} onChange={e => setMemberForm(f => ({ ...f, member_code: e.target.value }))} />
            <input className="input" placeholder="Member name" value={memberForm.member_name} onChange={e => setMemberForm(f => ({ ...f, member_name: e.target.value }))} />
            <input className="input" placeholder="Patient ID" type="number" value={memberForm.patient_id} onChange={e => setMemberForm(f => ({ ...f, patient_id: e.target.value }))} />
            <input className="input" placeholder="Relation" value={memberForm.relation} onChange={e => setMemberForm(f => ({ ...f, relation: e.target.value }))} />
            <select className="input" value={memberForm.status} onChange={e => setMemberForm(f => ({ ...f, status: e.target.value }))}><option value="active">Active</option><option value="inactive">Inactive</option><option value="expired">Expired</option></select>
            <div className="flex gap-2"><button type="submit" className="btn-primary" disabled={saveMemberMutation.isPending}>{saveMemberMutation.isPending ? 'Saving…' : memberEditId ? 'Update member' : 'Add member'}</button>{memberEditId && <button type="button" className="btn-secondary" onClick={cancelMemberEdit}>Cancel edit</button>}</div>
          </form>
          <table className="table-base"><thead><tr><th>Code</th><th>Name</th><th>Patient</th><th>Status</th><th>Action</th></tr></thead><tbody>{membersLoading ? <SkeletonRows cols={5} /> : schemeMembers.length === 0 ? <tr><td colSpan={5}>No members</td></tr> : schemeMembers.map(member => <tr key={member.id}><td>{member.member_code ?? '—'}</td><td>{member.member_name ?? '—'}</td><td>{member.patient_id ?? '—'}</td><td>{member.status ?? 'active'}</td><td><div className="flex gap-1"><button type="button" className="btn-ghost px-2 py-1 text-xs text-[var(--color-primary)]" onClick={() => editMember(member)}>Edit</button><button type="button" className="btn-ghost px-2 py-1 text-xs text-red-500" onClick={() => deleteMemberMutation.mutate(member.id)} disabled={deleteMemberMutation.isPending}>Deactivate</button></div></td></tr>)}</tbody></table>
        </div>
      </Modal>}
    </div>
  );
}

/* ───── Price Categories ────────────────────────────────── */
const PCAT_INIT = { category_name: '', category_code: '', is_default: false };

function PriceCategoriesTab() {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(PCAT_INIT);

  const { data, isLoading: loading } = useApiQuery<{ data: PriceCategory[]; total?: number }>(
    queryKeys.billingMaster.priceCategories(page),
    '/api/billing-master/price-categories',
  );

  const items = data?.data ?? [];
  const total = data?.total ?? items.length;

  const saveMutation = useApiMutation<unknown, Record<string, unknown>>(
    editId ? 'put' : 'post',
    editId ? `/api/billing-master/price-categories/${editId}` : '/api/billing-master/price-categories',
    {
      onSuccess: () => {
        toast.success(editId ? t('master.priceCategories.updated') : t('master.priceCategories.created'));
        setShowForm(false); setForm(PCAT_INIT); setEditId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const openEdit = (c: PriceCategory) => { setEditId(c.id); setForm({ category_name: c.category_name, category_code: c.category_code ?? '', is_default: c.is_default }); setShowForm(true); };
  const openCreate = () => { setEditId(null); setForm(PCAT_INIT); setShowForm(true); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.priceCategories.newCategory')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.priceCategories.categoryName')}</th><th>{t('master.priceCategories.code')}</th><th>{t('master.priceCategories.default')}</th><th>{t('status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={5} />
            : items.length === 0 ? <tr><td colSpan={5}><EmptyState icon={<Layers className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.priceCategories.noCategories')} description={t('master.priceCategories.noCategoriesDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.common.new')}</button>} /></td></tr>
            : items.map(c => <tr key={c.id}><td className="font-medium">{c.category_name}</td><td className="font-data text-sm">{c.category_code ?? '—'}</td><td>{c.is_default ? <span className="badge badge-success">{t('master.priceCategories.default')}</span> : '—'}</td><td><span className={`badge ${c.is_active ? 'badge-success' : 'badge-warning'}`}>{c.is_active ? t('active') : t('inactive')}</span></td><td><button onClick={() => openEdit(c)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button></td></tr>)}
        </tbody>
      </table></div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
      {showForm && <Modal title={editId ? t('master.priceCategories.editCategory') : t('master.priceCategories.newCategoryTitle')} onClose={() => { setShowForm(false); setEditId(null); setForm(PCAT_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('master.priceCategories.categoryNameLabel')}</label><input className="input" required value={form.category_name} onChange={e => setForm(f => ({ ...f, category_name: e.target.value }))} /></div>
          <div><label className="label">{t('master.priceCategories.code')}</label><input className="input" value={form.category_code} onChange={e => setForm(f => ({ ...f, category_code: e.target.value }))} /></div>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_default} onChange={e => setForm(f => ({ ...f, is_default: e.target.checked }))} className="rounded" /><span className="text-sm">{t('master.priceCategories.setAsDefault')}</span></label>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(PCAT_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button><button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* ───── Price Matrix ─────────────────────────────────────── */
function PriceMatrixTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [cellPrices, setCellPrices] = useState<Record<string, string>>({});
  const [changedCells, setChangedCells] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useApiQuery<{ data: PriceMatrixResponse }>(
    ['billing-master', 'price-matrix', appliedSearch],
    `/api/billing-master/price-matrix?limit=150${appliedSearch ? `&search=${encodeURIComponent(appliedSearch)}` : ''}`,
  );
  const matrix = data?.data;
  const categories = matrix?.categories ?? [];
  const rows = matrix?.rows ?? [];

  useEffect(() => {
    if (!matrix) return;
    const nextPrices: Record<string, string> = {};
    for (const row of matrix.rows) {
      for (const price of row.prices) {
        nextPrices[`${row.service_item_id}:${price.price_category_id}`] = String(price.price ?? 0);
      }
    }
    setCellPrices(nextPrices);
    setChangedCells({});
  }, [matrix]);

  const saveMutation = useApiMutation<unknown, { mappings: Array<{ service_item_id: number; price_category_id: number; price: number; is_discount_applicable: boolean }> }>(
    'put',
    '/api/billing-master/price-matrix',
    {
      onSuccess: () => {
        toast.success('Price matrix saved');
        setChangedCells({});
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || 'Failed to save price matrix'); },
    },
  );

  const changedCount = Object.values(changedCells).filter(Boolean).length;
  const setCellPrice = (rowId: number, categoryId: number, value: string) => {
    const key = `${rowId}:${categoryId}`;
    setCellPrices((prev) => ({ ...prev, [key]: value }));
    setChangedCells((prev) => ({ ...prev, [key]: true }));
  };

  const saveChanges = () => {
    const mappings = Object.keys(changedCells)
      .filter((key) => changedCells[key])
      .map((key) => {
        const [itemId, categoryId] = key.split(':').map(Number);
        const row = rows.find((entry) => entry.service_item_id === itemId);
        const priceCell = row?.prices.find((price) => price.price_category_id === categoryId);
        return {
          service_item_id: itemId,
          price_category_id: categoryId,
          price: Number(cellPrices[key] ?? 0),
          is_discount_applicable: priceCell?.is_discount_applicable ?? row?.allow_discount ?? true,
        };
      })
      .filter((mapping) => Number.isFinite(mapping.service_item_id) && Number.isFinite(mapping.price_category_id) && Number.isFinite(mapping.price) && mapping.price >= 0);

    if (mappings.length === 0) {
      toast.error('No valid price changes to save');
      return;
    }
    saveMutation.mutate({ mappings });
  };

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Price Matrix</h3>
          <p className="text-sm text-[var(--color-text-muted)]">Manage service item prices across Billing Master price categories. Inherited cells use the item base price until overridden.</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input className="input min-w-[260px]" value={search} placeholder="Search service or code" onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') setAppliedSearch(search.trim()); }} />
          <button type="button" className="btn-secondary" onClick={() => setAppliedSearch(search.trim())}>Search</button>
          <button type="button" className="btn-primary" onClick={saveChanges} disabled={changedCount === 0 || saveMutation.isPending}>{saveMutation.isPending ? 'Saving…' : `Save ${changedCount || ''}`}</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base min-w-[900px]">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white dark:bg-slate-800 z-10">Service</th>
                <th>Department</th>
                <th>Base</th>
                {categories.map((category) => <th key={category.id}>{category.category_name}{category.is_default ? <span className="ml-1 badge badge-success">Default</span> : null}</th>)}
              </tr>
            </thead>
            <tbody>
              {isLoading ? <SkeletonRows cols={Math.max(4, categories.length + 3)} /> : rows.length === 0 ? (
                <tr><td colSpan={Math.max(4, categories.length + 3)}><EmptyState icon={<Layers className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No service items found" description="Create service items first, then manage category-wise prices here." /></td></tr>
              ) : rows.map((row) => (
                <tr key={row.service_item_id}>
                  <td className="sticky left-0 bg-white dark:bg-slate-800 z-10">
                    <div className="font-medium">{row.item_name}</div>
                    <div className="text-xs text-[var(--color-text-muted)] font-data">{row.item_code ?? 'No code'}</div>
                  </td>
                  <td>{row.department_name ?? '—'}</td>
                  <td className="font-data">৳{Number(row.base_price ?? 0).toLocaleString()}</td>
                  {categories.map((category) => {
                    const cell = row.prices.find((price) => price.price_category_id === category.id);
                    const key = `${row.service_item_id}:${category.id}`;
                    return (
                      <td key={key} className="min-w-[150px]">
                        <input
                          className={`input text-sm font-data ${changedCells[key] ? 'border-[var(--color-primary)] bg-sky-50' : ''}`}
                          inputMode="decimal"
                          value={cellPrices[key] ?? ''}
                          onChange={(event) => setCellPrice(row.service_item_id, category.id, event.target.value)}
                        />
                        {cell?.inherited_from_base ? <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">Inherited base price</div> : <div className="mt-1 text-[10px] text-emerald-700">Custom category price</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ───── Service Departments ──────────────────────────────── */
const DEPT_INIT = { department_name: '', department_code: '' };

function ServiceDeptsTab() {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(DEPT_INIT);

  const { data, isLoading: loading } = useApiQuery<{ data: ServiceDept[]; total: number }>(
    queryKeys.billingMaster.departments(page),
    `/api/billing-master/service-departments?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
  );

  const items = data?.data ?? [];
  const total = data?.total ?? items.length;

  const saveMutation = useApiMutation<unknown, Record<string, unknown>>(
    editId ? 'put' : 'post',
    editId ? `/api/billing-master/service-departments/${editId}` : '/api/billing-master/service-departments',
    {
      onSuccess: () => {
        toast.success(editId ? t('master.departments.updated') : t('master.departments.created'));
        setShowForm(false); setForm(DEPT_INIT); setEditId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const deleteMutation = useApiMutation<unknown, number>(
    'delete',
    (id) => `/api/billing-master/service-departments/${id}`,
    {
      onSuccess: () => {
        toast.success(t('master.common.deactivated'));
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const openEdit = (d: ServiceDept) => {
    setEditId(d.id);
    setForm({ department_name: d.department_name, department_code: d.department_code ?? '' });
    setShowForm(true);
  };
  const openCreate = () => { setEditId(null); setForm(DEPT_INIT); setShowForm(true); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };
  const handleDelete = (id: number) => {
    if (!confirm(t('master.common.deactivate'))) return;
    deleteMutation.mutate(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.departments.newDepartment')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.departments.deptName')}</th><th>{t('master.departments.code')}</th><th>{t('status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : items.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<Building2 className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.departments.noDepartments')} description={t('master.departments.noDepartmentsDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.departments.newDepartment')}</button>} /></td></tr>
            : items.map(d => <tr key={d.id}><td className="font-medium">{d.department_name}</td><td className="font-data text-sm">{d.department_code ?? '—'}</td><td><span className={`badge ${d.is_active ? 'badge-success' : 'badge-warning'}`}>{d.is_active ? t('active') : t('inactive')}</span></td><td><div className="flex gap-1"><button onClick={() => openEdit(d)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button><button onClick={() => handleDelete(d.id)} className="btn-ghost p-1.5 text-red-500"><Trash2 className="w-4 h-4" /></button></div></td></tr>)}
        </tbody>
      </table></div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
      {showForm && <Modal title={editId ? t('master.departments.editDepartment') : t('master.departments.newDepartmentTitle')} onClose={() => { setShowForm(false); setEditId(null); setForm(DEPT_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('master.departments.deptNameLabel')}</label><input className="input" required value={form.department_name} onChange={e => setForm(f => ({ ...f, department_name: e.target.value }))} /></div>
          <div><label className="label">{t('master.departments.code')}</label><input className="input" value={form.department_code} onChange={e => setForm(f => ({ ...f, department_code: e.target.value }))} /></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(DEPT_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button><button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* ───── Service Items ────────────────────────────────── */
const ITEM_INIT = {
  item_name: '',
  item_code: '',
  service_department_id: null as number | null,
  price: '0',
  allow_discount: true,
  tax_applicable: true,
  tax_percent: '0',
  description: '',
  is_commissionable: true,
  performer_payout_enabled: false,
  performer_rate_type: 'flat' as 'flat' | 'percent',
  performer_flat_amount: '0',
  performer_percent: '0',
  performer_effective_from: getTodayGMT6(),
  performer_notes: '',
};

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function nextCalendarDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return getTodayGMT6();
  const next = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return next.toISOString().slice(0, 10);
}

function minimumPerformerRuleEffectiveDate(latestRule: PerformerPayoutRule | null): string {
  const today = getTodayGMT6();
  if (!latestRule) return today;
  const nextVersionDate = nextCalendarDate(latestRule.effective_from);
  return nextVersionDate > today ? nextVersionDate : today;
}

function samePerformerRuleConfiguration(
  form: typeof ITEM_INIT,
  loadedRule: PerformerPayoutRule | null,
): boolean {
  const enabled = Boolean(form.performer_payout_enabled);
  if (!loadedRule) return !enabled;
  if (enabled !== Boolean(loadedRule.enabled)) return false;
  if (!enabled) return true;
  if (form.performer_rate_type !== loadedRule.rate_type) return false;

  const formValue = form.performer_rate_type === 'flat'
    ? Math.max(0, Number(form.performer_flat_amount) || 0)
    : Math.max(0, Math.min(100, Number(form.performer_percent) || 0));
  const loadedValue = loadedRule.rate_type === 'flat'
    ? Number(loadedRule.flat_amount ?? 0)
    : Number(loadedRule.percent ?? 0);
  const formNotes = form.performer_notes.trim() || null;
  const loadedNotes = loadedRule.notes?.trim() || null;
  return formValue === loadedValue && formNotes === loadedNotes;
}

function ServiceItemsTab() {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(ITEM_INIT);
  const [loadedPerformerRule, setLoadedPerformerRule] = useState<PerformerPayoutRule | null>(null);
  const [isSavingItem, setIsSavingItem] = useState(false);

  const { data: depts } = useApiQuery<{ data: ServiceDept[] }>(queryKeys.billingMaster.departments(1), '/api/billing-master/service-departments?limit=1000');

  const { data, isLoading: loading } = useApiQuery<{ data: ServiceItem[]; total?: number; pagination?: { total?: number } }>(
    queryKeys.billingMaster.items(page, search, deptFilter),
    `/api/billing-master/service-items?page=${page}&per_page=${PAGE_SIZE}${search ? `&search=${encodeURIComponent(search)}` : ''}${deptFilter ? `&department_id=${deptFilter}` : ''}`,
  );

  const items = data?.data ?? [];
  const total = data?.pagination?.total ?? data?.total ?? items.length;
  const selectedDepartment = depts?.data?.find((department) => department.id === form.service_department_id);
  const isDiagnosticDepartment = selectedDepartment?.department_code === 'LAB'
    || selectedDepartment?.department_code === 'RAD';
  const selectedDiagnosticKind = selectedDepartment?.department_code === 'LAB'
    ? 'lab'
    : selectedDepartment?.department_code === 'RAD'
      ? 'radiology'
      : null;
  const testPrice = Math.max(0, Number(form.price) || 0);
  const performerReservePreview = form.performer_rate_type === 'percent'
    ? Math.min(testPrice, Math.round(testPrice * Math.max(0, Number(form.performer_percent) || 0)) / 100)
    : Math.min(testPrice, Math.max(0, Number(form.performer_flat_amount) || 0));
  const remainingCommissionBasePreview = Math.max(0, Math.round((testPrice - performerReservePreview) * 100) / 100);

  const deleteMutation = useApiMutation<unknown, number>(
    'delete',
    (id) => `/api/billing-master/service-items/${id}`,
    {
      onSuccess: () => {
        toast.success(t('master.common.deactivated'));
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const openEdit = async (item: ServiceItem) => {
    const baseForm = {
      ...ITEM_INIT,
      item_name: item.item_name,
      item_code: item.item_code ?? '',
      service_department_id: item.service_department_id ?? null,
      price: String(item.price),
      allow_discount: normalizeBoolean(item.allow_discount),
      tax_applicable: normalizeBoolean(item.tax_applicable),
      tax_percent: String(item.tax_percent),
      description: item.description ?? '',
      is_commissionable: item.is_commissionable == null ? true : normalizeBoolean(item.is_commissionable),
      performer_effective_from: getTodayGMT6(),
    };
    setEditId(item.id);
    setLoadedPerformerRule(null);
    setForm(baseForm);
    setShowForm(true);

    const department = depts?.data?.find((row) => row.id === item.service_department_id);
    const diagnostic = department?.department_code === 'LAB' || department?.department_code === 'RAD';
    if (!diagnostic) return;

    try {
      const rule = await api.get<PerformerPayoutRuleResponse>(`/api/billing-master/service-items/${item.id}/performer-payout-rule`);
      const latestRule = rule.history?.[0] ?? rule.current;
      setLoadedPerformerRule(latestRule);
      setForm((current) => ({
        ...current,
        performer_payout_enabled: Boolean(latestRule?.enabled),
        performer_rate_type: latestRule?.rate_type ?? 'flat',
        performer_flat_amount: String(latestRule?.flat_amount ?? 0),
        performer_percent: String(latestRule?.percent ?? 0),
        performer_effective_from: minimumPerformerRuleEffectiveDate(latestRule),
        performer_notes: latestRule?.notes ?? '',
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load performer payout rule');
    }
  };
  const openCreate = () => {
    setEditId(null);
    setLoadedPerformerRule(null);
    setForm({ ...ITEM_INIT, performer_effective_from: getTodayGMT6() });
    setShowForm(true);
  };
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingItem(true);
    let persistedServiceItemId = editId;
    let itemWasSaved = false;
    const performerRuleKindChanged = Boolean(
      loadedPerformerRule
      && loadedPerformerRule?.diagnostic_kind !== selectedDiagnosticKind,
    );
    const performerRuleChanged = isDiagnosticDepartment
      && (performerRuleKindChanged || !samePerformerRuleConfiguration(form, loadedPerformerRule));
    const minimumEffectiveDate = minimumPerformerRuleEffectiveDate(loadedPerformerRule);
    const performerRuleEffectiveFrom = form.performer_effective_from < minimumEffectiveDate
      ? minimumEffectiveDate
      : form.performer_effective_from;
    try {
      const itemPayload = {
        item_name: form.item_name,
        item_code: form.item_code || undefined,
        service_department_id: form.service_department_id ?? undefined,
        price: parseFloat(form.price),
        allow_discount: Boolean(form.allow_discount),
        tax_applicable: Boolean(form.tax_applicable),
        tax_percent: parseFloat(form.tax_percent),
        is_commissionable: selectedDepartment?.department_code === 'LAB'
          ? Boolean(form.is_commissionable)
          : undefined,
        description: form.description || undefined,
      };
      const response = editId
        ? await api.put<{ id?: number; message?: string }>(`/api/billing-master/service-items/${editId}`, itemPayload)
        : await api.post<{ id?: number; message?: string }>('/api/billing-master/service-items', itemPayload);
      persistedServiceItemId = Number(response.id ?? editId ?? 0) || null;
      itemWasSaved = true;

      if (isDiagnosticDepartment && performerRuleChanged) {
        if (!persistedServiceItemId) throw new Error('Service item was saved but its ID was not returned for performer rule setup');
        const rulePayload = form.performer_payout_enabled
          ? form.performer_rate_type === 'flat'
            ? {
                enabled: true as const,
                rate_type: 'flat' as const,
                flat_amount: Math.max(0, Number(form.performer_flat_amount) || 0),
                effective_from: performerRuleEffectiveFrom,
                notes: form.performer_notes.trim() || undefined,
              }
            : {
                enabled: true as const,
                rate_type: 'percent' as const,
                percent: Math.max(0, Math.min(100, Number(form.performer_percent) || 0)),
                effective_from: performerRuleEffectiveFrom,
                notes: form.performer_notes.trim() || undefined,
              }
          : {
              enabled: false as const,
              effective_from: performerRuleEffectiveFrom,
              notes: form.performer_notes.trim() || undefined,
            };
        await api.put(`/api/billing-master/service-items/${persistedServiceItemId}/performer-payout-rule`, rulePayload);
      }

      toast.success(editId ? t('master.serviceItems.updated') : t('master.serviceItems.created'));
      setShowForm(false);
      setForm(ITEM_INIT);
      setLoadedPerformerRule(null);
      setEditId(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
    } catch (error) {
      if (itemWasSaved && persistedServiceItemId && isDiagnosticDepartment) {
        setEditId(persistedServiceItemId);
        toast.error(`Service item saved, but performer payout rule failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      } else {
        toast.error(error instanceof Error ? error.message : t('master.common.saveFailed'));
      }
    } finally {
      setIsSavingItem(false);
    }
  };
  const handleDelete = (id: number) => {
    if (!confirm(t('master.common.deactivate'))) return;
    deleteMutation.mutate(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 justify-between">
        <div className="flex gap-2">
          <input className="input w-48" placeholder={t('master.serviceItems.search')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
          <select className="input w-40" value={deptFilter ?? ''} onChange={e => { setDeptFilter(e.target.value ? Number(e.target.value) : null); setPage(1); }}>
            <option value="">{t('master.serviceItems.allDepts')}</option>
            {depts?.data?.map(d => <option key={d.id} value={d.id}>{d.department_name}</option>)}
          </select>
        </div>
        <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.serviceItems.newItem')}</button>
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.serviceItems.itemName')}</th><th>{t('master.serviceItems.code')}</th><th>{t('master.serviceItems.department')}</th><th>{t('master.serviceItems.price')}</th><th>{t('master.serviceItems.discount')}</th><th>{t('master.serviceItems.tax')}</th><th>{t('status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={8} />
            : items.length === 0 ? <tr><td colSpan={8}><EmptyState icon={<CreditCard className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.serviceItems.noItems')} description={t('master.serviceItems.noItemsDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.serviceItems.newItem')}</button>} /></td></tr>
            : items.map(item => <tr key={item.id}><td className="font-medium">{item.item_name}</td><td className="font-data text-sm">{item.item_code ?? '—'}</td><td>{(item as any).department_name ?? '—'}</td><td className="font-data">{Number(item.price).toFixed(2)}</td><td>{normalizeBoolean(item.allow_discount) ? <span className="badge badge-success">{t('yes')}</span> : <span className="badge badge-warning">{t('no')}</span>}</td><td>{normalizeBoolean(item.tax_applicable) ? `${item.tax_percent}%` : '—'}</td><td><span className={`badge ${item.is_active ? 'badge-success' : 'badge-warning'}`}>{item.is_active ? t('active') : t('inactive')}</span></td><td><div className="flex gap-1"><button onClick={() => openEdit(item as any)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button><button onClick={() => handleDelete(item.id)} className="btn-ghost p-1.5 text-red-500"><Trash2 className="w-4 h-4" /></button></div></td></tr>)}
        </tbody>
      </table></div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
      {showForm && <Modal title={editId ? t('master.serviceItems.editItem') : t('master.serviceItems.newItemTitle')} onClose={() => { setShowForm(false); setEditId(null); setLoadedPerformerRule(null); setForm(ITEM_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('master.serviceItems.itemNameLabel')}</label><input className="input" required value={form.item_name} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('master.serviceItems.code')}</label><input className="input" value={form.item_code} onChange={e => setForm(f => ({ ...f, item_code: e.target.value }))} /></div>
            <div><label className="label">{t('master.serviceItems.department')}</label><select className="input" value={form.service_department_id ?? ''} onChange={e => {
              const departmentId = e.target.value ? Number(e.target.value) : null;
              const department = depts?.data?.find((row) => row.id === departmentId);
              const diagnostic = department?.department_code === 'LAB' || department?.department_code === 'RAD';
              setForm(f => ({ ...f, service_department_id: departmentId, performer_payout_enabled: diagnostic ? f.performer_payout_enabled : false }));
            }}><option value="">{t('master.serviceItems.selectDept')}</option>{depts?.data?.map(d => <option key={d.id} value={d.id}>{d.department_name}</option>)}</select></div>
          </div>
          <div><label className="label">{t('master.serviceItems.price')}</label><input className="input" type="number" min="0" step="0.01" required value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.allow_discount} onChange={e => setForm(f => ({ ...f, allow_discount: e.target.checked }))} className="rounded" /><span className="text-sm">{t('master.serviceItems.allowDiscount')}</span></label>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.tax_applicable} onChange={e => setForm(f => ({ ...f, tax_applicable: e.target.checked }))} className="rounded" /><span className="text-sm">{t('master.serviceItems.taxApplicable')}</span></label>
          </div>
          {form.tax_applicable && <div><label className="label">{t('master.serviceItems.taxPercent')}</label><input className="input" type="number" min="0" max="100" step="0.1" value={form.tax_percent} onChange={e => setForm(f => ({ ...f, tax_percent: e.target.value }))} /></div>}
          {selectedDepartment?.department_code === 'LAB' && <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/20">
            <label className="label">{t('master.serviceItems.commissionEligibility')}</label>
            <select
              className="input"
              value={form.is_commissionable ? '1' : '0'}
              onChange={e => setForm(f => ({ ...f, is_commissionable: e.target.value === '1' }))}
            >
              <option value="1">{t('master.serviceItems.commissionEligibilityYes')}</option>
              <option value="0">{t('master.serviceItems.commissionEligibilityNo')}</option>
            </select>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">{t('master.serviceItems.commissionEligibilityHint')}</p>
          </div>}
          {isDiagnosticDepartment && <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900 dark:bg-blue-950/20">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-blue-950 dark:text-blue-100">Performer Payout Rule</div>
                <p className="mt-1 text-xs text-blue-700 dark:text-blue-200">Reserve the performer fee automatically for this LAB/RAD test. Reception can assign the doctor later from Cash Operations.</p>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-blue-900 dark:text-blue-100"><input type="checkbox" checked={form.performer_payout_enabled} onChange={e => setForm(f => ({ ...f, performer_payout_enabled: e.target.checked }))} />Enable</label>
            </div>
            {form.performer_payout_enabled && <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Rule type</label><select className="input" value={form.performer_rate_type} onChange={e => setForm(f => ({ ...f, performer_rate_type: e.target.value as 'flat' | 'percent' }))}><option value="flat">Fixed amount</option><option value="percent">Percentage</option></select></div>
                {form.performer_rate_type === 'flat'
                  ? <div><label className="label">Reserved amount per unit</label><input className="input" type="number" min="0" step="0.01" value={form.performer_flat_amount} onChange={e => setForm(f => ({ ...f, performer_flat_amount: e.target.value }))} /></div>
                  : <div><label className="label">Reserved percentage</label><input className="input" type="number" min="0" max="100" step="0.01" value={form.performer_percent} onChange={e => setForm(f => ({ ...f, performer_percent: e.target.value }))} /></div>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Effective from</label><input className="input" type="date" required min={minimumPerformerRuleEffectiveDate(loadedPerformerRule)} value={form.performer_effective_from} onChange={e => setForm(f => ({ ...f, performer_effective_from: e.target.value }))} /></div>
                <div><label className="label">Internal note</label><input className="input" maxLength={500} value={form.performer_notes} onChange={e => setForm(f => ({ ...f, performer_notes: e.target.value }))} placeholder="Example: USG performer fee" /></div>
              </div>
              <div className="rounded-lg border border-blue-100 bg-white p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-slate-900 dark:text-blue-100">
                <span className="font-semibold">Preview:</span> Test price ৳{testPrice.toFixed(2)} · Performer reserve ৳{performerReservePreview.toFixed(2)} · Remaining commission base ৳{remainingCommissionBasePreview.toFixed(2)}
              </div>
            </div>}
          </div>}
          <div><label className="label">{t('master.serviceItems.description')}</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowForm(false); setEditId(null); setLoadedPerformerRule(null); setForm(ITEM_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button><button type="submit" disabled={isSavingItem} className="btn-primary">{isSavingItem ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* ───── Fiscal Years ────────────────────────────────── */
const FISCAL_INIT = { fiscal_year_name: '', start_date: '', end_date: '', is_current: false };

function FiscalYearsTab() {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(FISCAL_INIT);

  const { data, isLoading: loading } = useApiQuery<{ data: FiscalYear[]; total: number }>(
    queryKeys.billingMaster.fiscalYears(page),
    `/api/billing-master/fiscal-years?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
  );

  const items = data?.data ?? [];
  const total = data?.total ?? items.length;

  const saveMutation = useApiMutation<unknown, Record<string, unknown>>(
    editId ? 'put' : 'post',
    editId ? `/api/billing-master/fiscal-years/${editId}` : '/api/billing-master/fiscal-years',
    {
      onSuccess: () => {
        toast.success(editId ? t('master.fiscalYears.updated') : t('master.fiscalYears.created'));
        setShowForm(false); setForm(FISCAL_INIT); setEditId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const openEdit = (f: FiscalYear) => {
    setEditId(f.id);
    setForm({ fiscal_year_name: f.fiscal_year_name, start_date: f.start_date.split('T')[0], end_date: f.end_date.split('T')[0], is_current: f.is_current });
    setShowForm(true);
  };
  const openCreate = () => { setEditId(null); setForm(FISCAL_INIT); setShowForm(true); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.fiscalYears.newFiscalYear')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.fiscalYears.name')}</th><th>{t('master.fiscalYears.startDate')}</th><th>{t('master.fiscalYears.endDate')}</th><th>{t('master.fiscalYears.current')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={5} />
            : items.length === 0 ? <tr><td colSpan={5}><EmptyState icon={<Calendar className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.fiscalYears.noFiscalYears')} description={t('master.fiscalYears.noFiscalYearsDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.fiscalYears.newFiscalYear')}</button>} /></td></tr>
            : items.map(f => <tr key={f.id}><td className="font-medium">{f.fiscal_year_name}</td><td className="font-data">{f.start_date.split('T')[0]}</td><td className="font-data">{f.end_date.split('T')[0]}</td><td>{f.is_current ? <span className="badge badge-success">{t('master.fiscalYears.current')}</span> : '—'}</td><td><button onClick={() => openEdit(f)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button></td></tr>)}
        </tbody>
      </table></div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
      {showForm && <Modal title={editId ? t('master.fiscalYears.editFiscalYear') : t('master.fiscalYears.newFiscalYearTitle')} onClose={() => { setShowForm(false); setEditId(null); setForm(FISCAL_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('master.fiscalYears.fiscalYearNameLabel')}</label><input className="input" required value={form.fiscal_year_name} onChange={e => setForm(f => ({ ...f, fiscal_year_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('master.fiscalYears.startDate')}</label><input className="input" type="date" required value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
            <div><label className="label">{t('master.fiscalYears.endDate')}</label><input className="input" type="date" required value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.is_current} onChange={e => setForm(f => ({ ...f, is_current: e.target.checked }))} className="rounded" /><span className="text-sm">{t('master.fiscalYears.setAsCurrent')}</span></label>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(FISCAL_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button><button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* ───── Credit Organizations ─────────────────────────── */
const CREDIT_INIT = { organization_name: '', organization_code: '', contact_person: '', contact_no: '', email: '', credit_limit: '0' };

function CreditOrgsTab() {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(CREDIT_INIT);

  const { data, isLoading: loading } = useApiQuery<{ data: CreditOrg[]; total: number }>(
    queryKeys.billingMaster.creditOrgs(page),
    `/api/billing-master/credit-organizations?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
  );

  const items = data?.data ?? [];
  const total = data?.total ?? items.length;

  const saveMutation = useApiMutation<unknown, Record<string, unknown>>(
    editId ? 'put' : 'post',
    editId ? `/api/billing-master/credit-organizations/${editId}` : '/api/billing-master/credit-organizations',
    {
      onSuccess: () => {
        toast.success(editId ? t('master.creditOrgs.updated') : t('master.creditOrgs.created'));
        setShowForm(false); setForm(CREDIT_INIT); setEditId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const openEdit = (c: CreditOrg) => {
    setEditId(c.id);
    setForm({ organization_name: c.organization_name, organization_code: c.organization_code ?? '', contact_person: c.contact_person ?? '', contact_no: c.contact_no ?? '', email: c.email ?? '', credit_limit: String(c.credit_limit) });
    setShowForm(true);
  };
  const openCreate = () => { setEditId(null); setForm(CREDIT_INIT); setShowForm(true); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ ...form, credit_limit: parseFloat(form.credit_limit) });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.creditOrgs.newOrg')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.creditOrgs.organization')}</th><th>{t('master.creditOrgs.code')}</th><th>{t('master.creditOrgs.contactPerson')}</th><th>{t('master.creditOrgs.creditLimit')}</th><th>{t('status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={6} />
            : items.length === 0 ? <tr><td colSpan={6}><EmptyState icon={<Building2 className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.creditOrgs.noOrgs')} description={t('master.creditOrgs.noOrgsDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.creditOrgs.newOrg')}</button>} /></td></tr>
            : items.map(c => <tr key={c.id}><td className="font-medium">{c.organization_name}</td><td className="font-data text-sm">{c.organization_code ?? '—'}</td><td className="font-data text-sm">{c.contact_person ?? '—'}</td><td className="font-data">{Number(c.credit_limit).toFixed(0)}</td><td><span className={`badge ${c.is_active ? 'badge-success' : 'badge-warning'}`}>{c.is_active ? t('active') : t('inactive')}</span></td><td><button onClick={() => openEdit(c)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button></td></tr>)}
        </tbody>
      </table></div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
      {showForm && <Modal title={editId ? t('master.creditOrgs.editOrg') : t('master.creditOrgs.newOrgTitle')} onClose={() => { setShowForm(false); setEditId(null); setForm(CREDIT_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('master.creditOrgs.orgNameLabel')}</label><input className="input" required value={form.organization_name} onChange={e => setForm(f => ({ ...f, organization_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('master.creditOrgs.code')}</label><input className="input" value={form.organization_code} onChange={e => setForm(f => ({ ...f, organization_code: e.target.value }))} /></div>
            <div><label className="label">{t('master.creditOrgs.creditLimit')}</label><input className="input" type="number" min="0" step="1" value={form.credit_limit} onChange={e => setForm(f => ({ ...f, credit_limit: e.target.value }))} /></div>
          </div>
          <div><label className="label">{t('master.creditOrgs.contactPerson')}</label><input className="input" value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('master.creditOrgs.phone')}</label><input className="input" value={form.contact_no} onChange={e => setForm(f => ({ ...f, contact_no: e.target.value }))} /></div>
            <div><label className="label">{t('master.creditOrgs.email')}</label><input className="input" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(CREDIT_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button><button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* ───── Billing Packages ──────────────────────────────── */
type PkgType = 'standard' | 'package_plus_bed' | 'package_included_days';
const PACKAGE_INIT = {
  package_name: '',
  package_code: '',
  description: '',
  total_price: '0',
  discount_percent: '0',
  package_type: 'standard' as PkgType,
};

const PKG_TYPE_OPTIONS: Array<{ value: PkgType; title: string; description: string; emoji: string }> = [
  { value: 'standard',              emoji: '🧾', title: 'Package only',             description: 'Package price থাকবে। Bed থাকলে selected bed/cabin rate অনুযায়ী bill হবে।' },
  { value: 'package_included_days', emoji: '🛏️', title: 'Package with bed',         description: 'Bed charge package price-এর মধ্যেই থাকবে। আলাদা daily bed bill হবে না।' },
  { value: 'package_plus_bed',      emoji: '➕', title: 'Package + selected bed',    description: 'Package price-এর সাথে selected bed/cabin-এর daily rate যোগ হবে।' },
];

function PackagesTab() {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(PACKAGE_INIT);

  const { data, isLoading: loading } = useApiQuery<{ data: BillingPackage[]; total: number }>(
    queryKeys.billingMaster.packages(page),
    `/api/billing-master/packages?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
  );

  const items = data?.data ?? [];
  const total = data?.total ?? items.length;

  const saveMutation = useApiMutation<unknown, Record<string, unknown>>(
    editId ? 'put' : 'post',
    editId ? `/api/billing-master/packages/${editId}` : '/api/billing-master/packages',
    {
      onSuccess: () => {
        toast.success(editId ? t('master.packages.updated', { defaultValue: 'Package updated' }) : t('master.packages.created'));
        setShowForm(false); setForm(PACKAGE_INIT); setEditId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const deleteMutation = useApiMutation<unknown, void>(
    'delete',
    editId ? `/api/billing-master/packages/${editId}` : '/api/billing-master/packages/0',
    {
      onSuccess: () => {
        toast.success(t('master.packages.deleted', { defaultValue: 'Package deactivated' }));
        setShowForm(false); setForm(PACKAGE_INIT); setEditId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const openCreate = () => { setEditId(null); setForm(PACKAGE_INIT); setShowForm(true); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      package_name: form.package_name,
      package_code: form.package_code || undefined,
      description: form.description || undefined,
      total_price: parseFloat(form.total_price),
      discount_percent: parseFloat(form.discount_percent),
      package_type: form.package_type,
      included_bed_days: 0,
      extra_bed_rate: 0,
    };
    saveMutation.mutate(payload);
  };

  const typeLabel = (pt?: string) => {
    const opt = PKG_TYPE_OPTIONS.find(o => o.value === pt);
    return opt ? opt.title : 'Standard';
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.packages.newPackage')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.packages.packageName')}</th><th>{t('master.packages.code')}</th><th>Type</th><th>{t('master.packages.totalPrice')}</th><th>{t('master.packages.discountPercent')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={6} />
            : items.length === 0 ? <tr><td colSpan={6}><EmptyState icon={<Package className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.packages.noPackages')} description={t('master.packages.noPackagesDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.packages.newPackage')}</button>} /></td></tr>
            : items.map(p => (
              <tr key={p.id}>
                <td className="font-medium">{p.package_name}</td>
                <td className="font-data text-sm">{p.package_code ?? '—'}</td>
                <td className="text-xs">{typeLabel(p.package_type)}</td>
                <td className="font-data">{Number(p.total_price).toFixed(0)}</td>
                <td className="font-data">{p.discount_percent}%</td>
                <td><button onClick={() => {
                  setEditId(p.id);
                  setForm({
                    package_name: p.package_name,
                    package_code: p.package_code ?? '',
                    description: p.description ?? '',
                    total_price: String(p.total_price),
                    discount_percent: String(p.discount_percent),
                    package_type: (p.package_type ?? 'standard') as PkgType,
                  });
                  setShowForm(true);
                }} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button></td>
              </tr>
            ))}
        </tbody>
      </table></div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
      {showForm && <Modal title={editId ? t('master.packages.editPackage') : t('master.packages.newPackageTitle')} onClose={() => { setShowForm(false); setEditId(null); setForm(PACKAGE_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Package type selector */}
          <div>
            <label className="label">Package Type <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1">
              {PKG_TYPE_OPTIONS.map(opt => {
                const selected = form.package_type === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, package_type: opt.value }))}
                    className={`text-left rounded-lg border p-3 transition ${selected ? 'border-[var(--color-primary)] bg-[var(--color-primary-subtle,#e0f2fe)] ring-1 ring-[var(--color-primary)]' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]'}`}
                  >
                    <div className="flex items-center gap-2 font-medium text-sm">
                      <span className="text-lg">{opt.emoji}</span>
                      <span>{opt.title}</span>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1 leading-snug">{opt.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Common fields */}
          <div><label className="label">{t('master.packages.packageNameLabel')} <span className="text-red-500">*</span></label><input className="input" required value={form.package_name} onChange={e => setForm(f => ({ ...f, package_name: e.target.value }))} placeholder="e.g., Normal Delivery 3 Days" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('master.packages.code')}</label><input className="input" value={form.package_code} onChange={e => setForm(f => ({ ...f, package_code: e.target.value }))} placeholder="PKG-001" /></div>
            <div><label className="label">{t('master.packages.totalPrice')} (৳) <span className="text-red-500">*</span></label><input className="input" type="number" min="0" step="1" required value={form.total_price} onChange={e => setForm(f => ({ ...f, total_price: e.target.value }))} /></div>
          </div>

          <div><label className="label">{t('master.packages.discountPercent')}</label><input className="input" type="number" min="0" max="100" step="0.1" value={form.discount_percent} onChange={e => setForm(f => ({ ...f, discount_percent: e.target.value }))} /></div>
          <div><label className="label">{t('master.packages.description')}</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Package-এ কী কী service অন্তর্ভুক্ত..." /></div>

          <div className="flex justify-between items-center gap-3 pt-2 border-t border-[var(--color-border)]">
            <div>
              {editId && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t('master.packages.deleteConfirm', { defaultValue: 'Deactivate this package?' }))) deleteMutation.mutate();
                  }}
                  disabled={deleteMutation.isPending}
                  className="btn-ghost text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" /> {deleteMutation.isPending ? t('master.common.saving') : t('master.common.delete', { defaultValue: 'Deactivate' })}
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(PACKAGE_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button>
              <button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button>
            </div>
          </div>
        </form>
      </Modal>}
    </div>
  );
}

/* ───── Memberships ────────────────────────────────────── */
const MEMBERSHIP_INIT = { membership_name: '', membership_code: '', discount_percent: '0', description: '' };

function MembershipsTab() {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(MEMBERSHIP_INIT);

  const { data, isLoading: loading } = useApiQuery<{ data: MembershipType[]; total: number }>(
    queryKeys.billingMaster.memberships(page),
    `/api/billing-master/membership-types?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
  );

  const items = data?.data ?? [];
  const total = data?.total ?? items.length;

  const saveMutation = useApiMutation<unknown, Record<string, unknown>>(
    editId ? 'put' : 'post',
    editId ? `/api/billing-master/membership-types/${editId}` : '/api/billing-master/membership-types',
    {
      onSuccess: () => {
        toast.success(editId ? t('master.memberships.membershipUpdated') : t('master.memberships.membershipCreated'));
        setShowForm(false); setForm(MEMBERSHIP_INIT); setEditId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const openEdit = (m: MembershipType) => {
    setEditId(m.id);
    setForm({ membership_name: m.membership_name, membership_code: m.membership_code ?? '', discount_percent: String(m.discount_percent), description: m.description ?? '' });
    setShowForm(true);
  };
  const openCreate = () => { setEditId(null); setForm(MEMBERSHIP_INIT); setShowForm(true); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ ...form, discount_percent: parseFloat(form.discount_percent) });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.memberships.newMembership')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.memberships.membershipName')}</th><th>{t('master.memberships.code')}</th><th>{t('master.memberships.discountPercent')}</th><th>{t('status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={5} />
            : items.length === 0 ? <tr><td colSpan={5}><EmptyState icon={<Award className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.memberships.noMemberships')} description={t('master.memberships.noMembershipsDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.memberships.newMembership')}</button>} /></td></tr>
            : items.map(m => <tr key={m.id}><td className="font-medium">{m.membership_name}</td><td className="font-data text-sm">{m.membership_code ?? '—'}</td><td className="font-data">{m.discount_percent}%</td><td><span className={`badge ${m.is_active ? 'badge-success' : 'badge-warning'}`}>{m.is_active ? t('active') : t('inactive')}</span></td><td><div className="flex gap-1"><button onClick={() => openEdit(m)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button></div></td></tr>)}
        </tbody>
      </table></div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
      {showForm && <Modal title={editId ? t('master.memberships.editMembership') : t('master.memberships.newMembershipTitle')} onClose={() => { setShowForm(false); setEditId(null); setForm(MEMBERSHIP_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('master.memberships.membershipNameLabel')}</label><input className="input" required value={form.membership_name} onChange={e => setForm(f => ({ ...f, membership_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('master.memberships.code')}</label><input className="input" value={form.membership_code} onChange={e => setForm(f => ({ ...f, membership_code: e.target.value }))} /></div>
            <div><label className="label">{t('master.memberships.discountPercent')}</label><input className="input" type="number" min="0" max="100" step="0.1" required value={form.discount_percent} onChange={e => setForm(f => ({ ...f, discount_percent: e.target.value }))} /></div>
          </div>
          <div><label className="label">{t('master.memberships.descriptionLabel')}</label><textarea className="input" rows={2} placeholder={t('master.memberships.benefitsPlaceholder')} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(MEMBERSHIP_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button><button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* ───── Deposit Heads ────────────────────────────────── */
const DEPOSIT_INIT = { head_name: '', head_code: '', description: '' };

function DepositHeadsTab() {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(DEPOSIT_INIT);

  const { data, isLoading: loading } = useApiQuery<{ data: DepositHead[]; total: number }>(
    queryKeys.billingMaster.depositHeads(page),
    `/api/billing-master/deposit-heads?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
  );

  const items = data?.data ?? [];
  const total = data?.total ?? items.length;

  const saveMutation = useApiMutation<unknown, Record<string, unknown>>(
    editId ? 'put' : 'post',
    editId ? `/api/billing-master/deposit-heads/${editId}` : '/api/billing-master/deposit-heads',
    {
      onSuccess: () => {
        toast.success(editId ? t('master.depositHeads.updated') : t('master.depositHeads.created'));
        setShowForm(false); setForm(DEPOSIT_INIT); setEditId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const openEdit = (d: DepositHead) => {
    setEditId(d.id);
    setForm({ head_name: d.head_name, head_code: d.head_code ?? '', description: d.description ?? '' });
    setShowForm(true);
  };
  const openCreate = () => { setEditId(null); setForm(DEPOSIT_INIT); setShowForm(true); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.depositHeads.newDeposit')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.depositHeads.headName')}</th><th>{t('master.depositHeads.code')}</th><th>{t('master.depositHeads.description')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : items.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<Wallet className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.depositHeads.noDeposits')} description={t('master.depositHeads.noDepositsDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.depositHeads.newDeposit')}</button>} /></td></tr>
            : items.map(d => <tr key={d.id}><td className="font-medium">{d.head_name}</td><td className="font-data text-sm">{d.head_code ?? '—'}</td><td className="text-sm text-[var(--color-text-secondary)]">{d.description ?? '—'}</td><td><button onClick={() => openEdit(d)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button></td></tr>)}
        </tbody>
      </table></div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
      {showForm && <Modal title={editId ? t('master.depositHeads.editDeposit') : t('master.depositHeads.newDepositTitle')} onClose={() => { setShowForm(false); setEditId(null); setForm(DEPOSIT_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('master.depositHeads.headNameLabel')}</label><input className="input" required value={form.head_name} onChange={e => setForm(f => ({ ...f, head_name: e.target.value }))} /></div>
          <div><label className="label">{t('master.depositHeads.code')}</label><input className="input" value={form.head_code} onChange={e => setForm(f => ({ ...f, head_code: e.target.value }))} /></div>
          <div><label className="label">{t('master.depositHeads.description')}</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(DEPOSIT_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button><button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* ───── Billing Counters ──────────────────────────────── */
interface BillingCounter { id: number; counter_name: string; counter_code?: string; counter_type: 'billing' | 'pharmacy' | 'lab' | 'ipd' | 'opd' | 'emergency' | 'general' | 'other'; location?: string; cash_visibility_mode?: string; is_active: boolean; }
const COUNTER_INIT = { counter_name: '', counter_code: '', counter_type: 'billing' as BillingCounter['counter_type'], location: '', cash_visibility_mode: 'show_all' };

function CountersTab() {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(COUNTER_INIT);

  const { data, isLoading: loading } = useApiQuery<{ data: BillingCounter[]; total: number }>(
    queryKeys.billingMaster.counters(page),
    `/api/billing-master/counters?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`,
  );

  const items = data?.data ?? [];
  const total = data?.total ?? items.length;

  const saveMutation = useApiMutation<unknown, Record<string, unknown>>(
    editId ? 'put' : 'post',
    editId ? `/api/billing-master/counters/${editId}` : '/api/billing-master/counters',
    {
      onSuccess: () => {
        toast.success(editId ? t('master.counters.updated') : t('master.counters.created'));
        setShowForm(false); setForm(COUNTER_INIT); setEditId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const deleteMutation = useApiMutation<unknown, number>(
    'delete',
    (id) => `/api/billing-master/counters/${id}`,
    {
      onSuccess: () => {
        toast.success(t('master.common.deactivated'));
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const openEdit = (c: BillingCounter) => {
    setEditId(c.id);
    setForm({ counter_name: c.counter_name, counter_code: c.counter_code ?? '', counter_type: c.counter_type, location: c.location ?? '', cash_visibility_mode: c.cash_visibility_mode ?? 'show_all' });
    setShowForm(true);
  };
  const openCreate = () => { setEditId(null); setForm(COUNTER_INIT); setShowForm(true); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };
  const handleDelete = (id: number) => {
    if (!confirm(t('master.common.deactivate'))) return;
    deleteMutation.mutate(id);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.counters.newCounter')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.counters.counterName')}</th><th>{t('master.counters.code')}</th><th>{t('master.counters.type')}</th><th>{t('master.counters.location')}</th><th>{t('status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={6} />
            : items.length === 0 ? <tr><td colSpan={6}><EmptyState icon={<Monitor className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.counters.noCounters')} description={t('master.counters.noCountersDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.counters.newCounter')}</button>} /></td></tr>
            : items.map(c => <tr key={c.id}><td className="font-medium">{c.counter_name}</td><td className="font-data text-sm">{c.counter_code ?? '—'}</td><td><span className="badge badge-info capitalize">{c.counter_type}</span></td><td className="text-sm">{c.location ?? '—'}</td><td><span className={`badge ${c.is_active ? 'badge-success' : 'badge-warning'}`}>{c.is_active ? t('active') : t('inactive')}</span></td><td><div className="flex gap-1"><button onClick={() => openEdit(c)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button><button onClick={() => handleDelete(c.id)} className="btn-ghost p-1.5 text-red-500"><Trash2 className="w-4 h-4" /></button></div></td></tr>)}
        </tbody>
      </table></div>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} />
      </div>
      {showForm && <Modal title={editId ? t('master.counters.editCounter') : t('master.counters.newCounterTitle')} onClose={() => { setShowForm(false); setEditId(null); setForm(COUNTER_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('master.counters.counterNameLabel')}</label><input className="input" required value={form.counter_name} onChange={e => setForm(f => ({ ...f, counter_name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">{t('master.counters.code')}</label><input className="input" value={form.counter_code} onChange={e => setForm(f => ({ ...f, counter_code: e.target.value }))} /></div>
            <div><label className="label">{t('master.counters.typeLabel')}</label><select className="input" value={form.counter_type} onChange={e => setForm(f => ({ ...f, counter_type: e.target.value as BillingCounter['counter_type'] }))}><option value="billing">Billing</option><option value="general">General</option><option value="opd">OPD</option><option value="ipd">IPD</option><option value="pharmacy">Pharmacy</option><option value="lab">Lab</option><option value="emergency">Emergency</option><option value="other">Other</option></select></div>
          </div>
          <div><label className="label">{t('master.counters.location')}</label><input className="input" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></div>
          <div><label className="label">Cash Visibility</label><select className="input" value={form.cash_visibility_mode} onChange={e => setForm(f => ({ ...f, cash_visibility_mode: e.target.value }))}><option value="show_all">Show All (Normal)</option><option value="blind_close">Blind Close (Hide Expected Cash)</option></select></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(COUNTER_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button><button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* ───── Referral Hospitals ──────────────────────────────── */
interface ReferralHospital { id: number; name: string; short_code?: string; is_active: boolean; }
const HOSPITAL_INIT = { name: '', short_code: '' };

function ReferralHospitalsTab() {
  const { t } = useTranslation('billing');
  const queryClient = useQueryClient();
  const [editId, setEditId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(HOSPITAL_INIT);

  const { data, isLoading: loading } = useApiQuery<{ hospitals: ReferralHospital[] }>(
    queryKeys.billingMaster.referralHospitals(),
    '/api/referral-hospitals',
  );

  const items = data?.hospitals ?? [];

  const saveMutation = useApiMutation<unknown, Record<string, unknown>>(
    editId ? 'put' : 'post',
    editId ? `/api/referral-hospitals/${editId}` : '/api/referral-hospitals',
    {
      onSuccess: () => {
        toast.success(editId ? t('master.referralHospitals.updated') : t('master.referralHospitals.created'));
        setShowForm(false); setForm(HOSPITAL_INIT); setEditId(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const toggleMutation = useApiMutation<unknown, { id: number; isActive: boolean }>(
    'put',
    (vars) => `/api/referral-hospitals/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('master.common.updated'));
        queryClient.invalidateQueries({ queryKey: queryKeys.billingMaster.all });
      },
      onError: (err) => { toast.error(err.message || t('master.common.saveFailed')); },
    },
  );

  const openEdit = (h: ReferralHospital) => {
    setEditId(h.id);
    setForm({ name: h.name, short_code: h.short_code ?? '' });
    setShowForm(true);
  };
  const openCreate = () => { setEditId(null); setForm(HOSPITAL_INIT); setShowForm(true); };
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = { name: form.name };
    if (form.short_code) payload.shortCode = form.short_code;
    saveMutation.mutate(payload);
  };
  const handleToggle = (h: ReferralHospital) => {
    toggleMutation.mutate({ id: h.id, isActive: !h.is_active });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('master.referralHospitals.newHospital')}</button></div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('master.referralHospitals.hospitalName')}</th><th>{t('master.referralHospitals.shortCode')}</th><th>{t('master.referralHospitals.status')}</th><th></th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : items.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<Hospital className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('master.referralHospitals.noHospitals')} description={t('master.referralHospitals.noHospitalsDesc')} action={<button onClick={openCreate} className="btn-primary mt-2"><Plus className="w-4 h-4" />{t('master.referralHospitals.newHospital')}</button>} /></td></tr>
            : items.map(h => <tr key={h.id}><td className="font-medium">{h.name}</td><td className="font-data text-sm">{h.short_code ?? '—'}</td><td><span className={`badge ${h.is_active ? 'badge-success' : 'badge-warning'}`}>{h.is_active ? t('master.referralHospitals.active') : t('master.referralHospitals.inactive')}</span></td><td><div className="flex gap-1"><button onClick={() => openEdit(h)} className="btn-ghost p-1.5 text-[var(--color-primary)]"><Edit2 className="w-4 h-4" /></button><button onClick={() => handleToggle(h)} className="btn-ghost p-1.5 text-amber-500" title={h.is_active ? t('master.referralHospitals.inactive') : t('master.referralHospitals.active')}><Trash2 className="w-4 h-4" /></button></div></td></tr>)}
        </tbody>
      </table></div>
      </div>
      {showForm && <Modal title={editId ? t('master.referralHospitals.editHospital') : t('master.referralHospitals.newHospitalTitle')} onClose={() => { setShowForm(false); setEditId(null); setForm(HOSPITAL_INIT); }}>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="label">{t('master.referralHospitals.hospitalNameLabel')}</label><input className="input" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div><label className="label">{t('master.referralHospitals.shortCode')}</label><input className="input" value={form.short_code} onChange={e => setForm(f => ({ ...f, short_code: e.target.value }))} /></div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => { setShowForm(false); setEditId(null); setForm(HOSPITAL_INIT); }} className="btn-secondary">{t('master.common.cancel')}</button><button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? t('master.common.saving') : editId ? t('master.common.update') : t('master.common.create')}</button></div>
        </form>
      </Modal>}
    </div>
  );
}

/* ───── IPD Bed Charge Policy ─────────────────────────── */
function BedChargePolicyTab() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useApiQuery<{ settings?: Record<string, string> }>(queryKeys.settings.all, '/api/settings');
  const settings = data?.settings ?? {};
  const [form, setForm] = useState({
    dayCountMode: 'rolling_24h',
    graceHours: '3',
    partialDayMode: 'full_day',
    halfDayAfterHours: '0',
    halfDayRatio: '0.5',
    checkInHour: '11',
    earlyCheckInGraceHours: '2',
  });

  useEffect(() => {
    if (!data?.settings) return;
    setForm({
      dayCountMode: settings.ipd_bed_charge_day_count_mode || 'rolling_24h',
      graceHours: settings.ipd_bed_charge_grace_hours || '3',
      partialDayMode: settings.ipd_bed_charge_partial_day_mode || 'full_day',
      halfDayAfterHours: settings.ipd_bed_charge_half_day_after_hours || '0',
      halfDayRatio: settings.ipd_bed_charge_half_day_ratio || '0.5',
      checkInHour: settings.ipd_bed_charge_check_in_hour || '11',
      earlyCheckInGraceHours: settings.ipd_bed_charge_early_check_in_grace_hours || '2',
    });
  }, [data?.settings]);

  const saveMutation = useApiMutation<unknown, Record<string, string>>('put', '/api/settings', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
      toast.success('Bed charge policy saved');
    },
    onError: () => toast.error('Failed to save bed charge policy'),
  });

  const set = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const previewDays = form.dayCountMode === 'rolling_24h'
    ? 'Example: 11:00 AM admission → next day 2:00 PM discharge = 1 day with 3 hours grace.'
    : 'Example: calendar date boundary counts as another billable day.';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      ipd_bed_charge_day_count_mode: form.dayCountMode,
      ipd_bed_charge_grace_hours: String(Math.max(0, Number(form.graceHours || 0))),
      ipd_bed_charge_partial_day_mode: form.partialDayMode,
      ipd_bed_charge_half_day_after_hours: String(Math.max(0, Number(form.halfDayAfterHours || 0))),
      ipd_bed_charge_half_day_ratio: String(Math.max(0, Math.min(1, Number(form.halfDayRatio || 0.5)))),
      ipd_bed_charge_check_in_hour: String(Math.max(0, Math.min(23.99, Number(form.checkInHour || 11)))),
      ipd_bed_charge_early_check_in_grace_hours: String(Math.max(0, Number(form.earlyCheckInGraceHours || 0))),
    });
  };

  return (
    <div className="card overflow-hidden">
      <div className="p-5 border-b border-[var(--color-border)]">
        <h2 className="section-title flex items-center gap-2"><Settings className="w-5 h-5" /> IPD Bed Charge Policy</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Configure how automatic bed/cabin charges count days. Default is hotel-style: 24 hours plus 3 hours grace.</p>
      </div>
      <form onSubmit={handleSubmit} className="p-5 space-y-5">
        {isLoading ? <div className="skeleton h-24 rounded-xl" /> : <>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="label">Day count method</label>
              <select className="input" value={form.dayCountMode} onChange={e => set('dayCountMode', e.target.value)}>
                <option value="rolling_24h">Hotel style: rolling 24 hours</option>
                <option value="calendar_day_inclusive">Calendar day inclusive</option>
              </select>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">{previewDays}</p>
            </div>
            <div>
              <label className="label">Grace hours after 24h</label>
              <input className="input" type="number" min="0" max="24" step="0.5" value={form.graceHours} onChange={e => set('graceHours', e.target.value)} />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Use 3 for 11 AM → next day 2 PM = 1 day.</p>
            </div>
            <div>
              <label className="label">Check-in time hour</label>
              <input className="input" type="number" min="0" max="23.99" step="0.5" value={form.checkInHour} onChange={e => set('checkInHour', e.target.value)} disabled={form.dayCountMode !== 'rolling_24h'} />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Use 11 for 11:00 AM as the daily bed-cycle start.</p>
            </div>
            <div>
              <label className="label">Early check-in grace hours</label>
              <input className="input" type="number" min="0" max="24" step="0.5" value={form.earlyCheckInGraceHours} onChange={e => set('earlyCheckInGraceHours', e.target.value)} disabled={form.dayCountMode !== 'rolling_24h'} />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Example: check-in 11 and grace 2 means 9–11 AM admission counts from 11 AM.</p>
            </div>
            <div>
              <label className="label">After grace</label>
              <select className="input" value={form.partialDayMode} onChange={e => set('partialDayMode', e.target.value)}>
                <option value="full_day">Charge full extra day</option>
                <option value="half_day">Charge half day within threshold</option>
                <option value="no_charge">Do not charge extra partial day</option>
              </select>
            </div>
            <div>
              <label className="label">Half-day threshold hours</label>
              <input className="input" type="number" min="0" max="24" step="0.5" value={form.halfDayAfterHours} onChange={e => set('halfDayAfterHours', e.target.value)} disabled={form.partialDayMode !== 'half_day'} />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Example: grace 3h + threshold 6h means 24h+3h to 24h+9h can bill half day.</p>
            </div>
            <div>
              <label className="label">Half-day bill ratio</label>
              <input className="input" type="number" min="0" max="1" step="0.1" value={form.halfDayRatio} onChange={e => set('halfDayRatio', e.target.value)} disabled={form.partialDayMode !== 'half_day'} />
            </div>
          </div>
          <div className="rounded-xl border border-[var(--color-border)] bg-slate-50 dark:bg-slate-900/30 p-4 text-sm text-[var(--color-text-secondary)]">
            Recommended setup for your current rule: <strong>Hotel style + 3 checkout grace hours + 11 AM check-in + 2 early check-in grace hours + full extra day after grace</strong>.
          </div>
          <div className="flex justify-end"><button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? 'Saving...' : 'Save Policy'}</button></div>
        </>}
      </form>
    </div>
  );
}

const TAB_MAP: Record<string, React.ComponentType> = {
  schemes: SchemesTab, categories: PriceCategoriesTab, priceMatrix: PriceMatrixTab, departments: ServiceDeptsTab, items: ServiceItemsTab,
  fiscal: FiscalYearsTab, credit: CreditOrgsTab, packages: PackagesTab, memberships: MembershipsTab, deposits: DepositHeadsTab,
  bedPolicy: BedChargePolicyTab,
  counters: CountersTab, referralHospitals: ReferralHospitalsTab,
};

export default function BillingMasterPage({ role = 'hospital_admin' }: { role?: string }) {
  const [activeTab, setActiveTab] = useState('overview');
  const TabComponent = TAB_MAP[activeTab];
  const { t } = useTranslation(['billing', 'common']);
  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('master.title')}</h1>
              <p className="section-subtitle">{t('master.subtitle')}</p>
            </div>
          </div>
        </div>
        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tab => { const Icon = tab.icon; return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            ><Icon className="w-4 h-4" />{t(`master.tabs.${tab.key}`)}</button>
          ); })}
        </div>
        {activeTab === 'overview' ? <OverviewTab onJump={setActiveTab} /> : TabComponent ? <TabComponent /> : <OverviewTab onJump={setActiveTab} />}
      </div>
    </DashboardLayout>
  );
}

import { useState, useEffect, useCallback } from 'react';
import {
  Tag, Building2, Users, BarChart2, Plus, X,
  ToggleLeft, ToggleRight, RefreshCw,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6, formatToTodayGMT6 } from '../lib/date-utils';
import { api } from '../lib/apiClient';

/* ───── Types ────────────────────────────────────────────── */
interface Scheme {
  SchemeId: number;
  SchemeName: string;
  CommissionPercent: number;
  Description?: string;
}

interface Organization {
  OrganizationId: number;
  OrganizationName: string;
  ContactPerson?: string;
  Phone?: string;
  Email?: string;
  Address?: string;
  IsActive: boolean;
}

interface Party {
  PartyId: number;
  PartyName: string;
  GroupName?: string;
  OrganizationName?: string;
  DefaultCommissionPercent: number;
  ContactNo?: string;
  Email?: string;
}

interface ReportRow {
  PartyName: string;
  OrganizationName?: string;
  TotalTransactions: number;
  TotalBillAmount: number;
  TotalCommission: number;
  AvgCommissionPercent: number;
}

interface OrgOption { OrganizationId: number; OrganizationName: string; }
interface PartyOption { PartyId: number; PartyName: string; }

/* ───── Constants ────────────────────────────────────────── */
const TODAY = getTodayGMT6();
const MONTH_AGO = formatToTodayGMT6(new Date(Date.now() - 30 * 86400000));

const TABS = [
  { key: 'schemes',       label: 'Schemes',       icon: Tag       },
  { key: 'organizations', label: 'Organizations',  icon: Building2 },
  { key: 'parties',       label: 'Parties',        icon: Users     },
  { key: 'report',        label: 'Report',         icon: BarChart2 },
];

/* ───── Shared helpers ───────────────────────────────────── */
function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {[...Array(5)].map((_, i) => (
        <tr key={i}>
          {[...Array(cols)].map((_, j) => (
            <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

function Modal({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)] sticky top-0 bg-white dark:bg-slate-800">
          <h3 className="font-semibold text-[var(--color-text)]">{title}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ───── Tab 1: Schemes ───────────────────────────────────── */
const SCHEME_INIT = { SchemeName: '', CommissionPercent: '', Description: '' };

function SchemesTab() {
  const { t } = useTranslation('marketing');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(SCHEME_INIT);
  const queryClient = useQueryClient();

  const { data: schemesData, isLoading: loading } = useApiQuery<{ Results: Scheme[] }>(
    queryKeys.marketingReferral.schemes(),
    '/api/marketing-referral/schemes',
  );
  const items = schemesData?.Results ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.marketingReferral.schemes() });
  const closeForm = () => { setShowForm(false); setForm(SCHEME_INIT); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/api/marketing-referral/schemes', {
        SchemeName: form.SchemeName,
        CommissionPercent: Number(form.CommissionPercent) || 0,
        Description: form.Description || undefined,
      });
      toast.success(t('schemes.toast.added'));
      closeForm(); invalidate();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? t('schemes.toast.saveFailed'));
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-muted)]">
          {t('schemes.count', { count: items.length })}
        </p>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> {t('schemes.addScheme')}
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('schemes.schemeName')}</th>
                <th>{t('schemes.commissionPercent')}</th>
                <th>{t('schemes.description')}</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? <SkeletonRows cols={4} />
                : items.length === 0
                  ? (
                    <tr>
                      <td colSpan={4}>
                        <EmptyState
                          icon={<Tag className="w-8 h-8 text-[var(--color-text-muted)]" />}
                          title={t('schemes.noSchemesYet')}
                          description={t('schemes.noSchemesDesc')}
                        />
                      </td>
                    </tr>
                  )
                  : items.map((s, i) => (
                    <tr key={s.SchemeId ?? i}>
                      <td className="text-[var(--color-text-muted)]">{i + 1}</td>
                      <td className="font-medium">{s.SchemeName}</td>
                      <td className="font-data">
                        <span className="badge-neutral">{s.CommissionPercent}%</span>
                      </td>
                      <td className="text-[var(--color-text-muted)] text-sm">{s.Description || '—'}</td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <Modal title={t('schemes.addSchemeTitle')} onClose={closeForm}>
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="label">{t('schemes.schemeNameLabel')}</label>
              <input className="input" required value={form.SchemeName} onChange={e => setForm({ ...form, SchemeName: e.target.value })} placeholder={t('schemes.schemeNamePlaceholder')} />
            </div>
            <div>
              <label className="label">{t('schemes.commissionPercentLabel')}</label>
              <input className="input" type="number" min="0" max="100" step="0.01" value={form.CommissionPercent} onChange={e => setForm({ ...form, CommissionPercent: e.target.value })} placeholder={t('schemes.commissionPlaceholder')} />
            </div>
            <div>
              <label className="label">{t('schemes.descriptionLabel')}</label>
              <textarea className="input" rows={2} value={form.Description} onChange={e => setForm({ ...form, Description: e.target.value })} placeholder={t('schemes.descriptionPlaceholder')} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeForm} className="btn-secondary">{t('schemes.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('schemes.saving') : t('schemes.addSchemeButton')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ───── Tab 2: Organizations ─────────────────────────────── */
const ORG_INIT = { OrganizationName: '', ContactPerson: '', Phone: '', Email: '', Address: '' };

function OrganizationsTab() {
  const { t } = useTranslation('marketing');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const [form, setForm] = useState(ORG_INIT);
  const queryClient = useQueryClient();

  const { data: orgsData, isLoading: loading } = useApiQuery<{ Results?: Organization[]; } & Organization[]>(
    queryKeys.marketingReferral.organizations(),
    '/api/marketing-referral/organizations',
  );
  const items: Organization[] = (orgsData as { Results?: Organization[] })?.Results ?? (Array.isArray(orgsData) ? orgsData : []);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.marketingReferral.organizations() });
  const closeForm = () => { setShowForm(false); setForm(ORG_INIT); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/api/marketing-referral/organizations', {
        OrganizationName: form.OrganizationName,
        ContactPerson: form.ContactPerson || undefined,
        Phone: form.Phone || undefined,
        Email: form.Email || undefined,
        Address: form.Address || undefined,
      });
      toast.success(t('organizations.toast.added'));
      closeForm(); invalidate();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? t('organizations.toast.saveFailed'));
    } finally { setSaving(false); }
  };

  const handleToggle = async (org: Organization) => {
    setToggling(org.OrganizationId);
    try {
      await api.put(`/api/marketing-referral/organizations/${org.OrganizationId}/toggle`, {});
      toast.success(t('organizations.toast.toggled', { name: org.OrganizationName, status: org.IsActive ? t('organizations.inactive') : t('organizations.active') }));
      invalidate();
    } catch { toast.error(t('organizations.toast.toggleFailed')); }
    finally { setToggling(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-muted)]">
          {t('organizations.count', { count: items.length })}
        </p>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> {t('organizations.addOrg')}
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('organizations.organization')}</th>
                <th>{t('organizations.contactPerson')}</th>
                <th>{t('organizations.phone')}</th>
                <th>{t('organizations.email')}</th>
                <th>{t('organizations.status')}</th>
                <th>{t('organizations.active')}</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? <SkeletonRows cols={7} />
                : items.length === 0
                  ? (
                    <tr>
                      <td colSpan={7}>
                        <EmptyState
                          icon={<Building2 className="w-8 h-8 text-[var(--color-text-muted)]" />}
                          title={t('organizations.noOrgsYet')}
                          description={t('organizations.noOrgsDesc')}
                        />
                      </td>
                    </tr>
                  )
                  : items.map((org, i) => (
                    <tr key={org.OrganizationId ?? i}>
                      <td className="text-[var(--color-text-muted)]">{i + 1}</td>
                      <td className="font-medium">{org.OrganizationName}</td>
                      <td className="text-[var(--color-text-secondary)]">{org.ContactPerson || '—'}</td>
                      <td className="font-data text-sm">{org.Phone || '—'}</td>
                      <td className="text-sm text-[var(--color-text-muted)]">{org.Email || '—'}</td>
                      <td>
                        <span className={org.IsActive ? 'badge-success' : 'badge-neutral'}>
                          {org.IsActive ? t('organizations.active') : t('organizations.inactive')}
                        </span>
                      </td>
                      <td>
                        <button
                          onClick={() => handleToggle(org)}
                          disabled={toggling === org.OrganizationId}
                          className={`btn-ghost p-1.5 transition-colors ${org.IsActive ? 'text-emerald-600' : 'text-[var(--color-text-muted)]'}`}
                          title={org.IsActive ? t('organizations.deactivate') : t('organizations.activate')}
                        >
                          {org.IsActive
                            ? <ToggleRight className="w-5 h-5" />
                            : <ToggleLeft className="w-5 h-5" />}
                        </button>
                      </td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <Modal title={t('organizations.addOrgTitle')} onClose={closeForm}>
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="label">{t('organizations.orgNameLabel')}</label>
              <input className="input" required value={form.OrganizationName} onChange={e => setForm({ ...form, OrganizationName: e.target.value })} placeholder={t('organizations.orgNamePlaceholder')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">{t('organizations.contactPersonLabel')}</label>
                <input className="input" value={form.ContactPerson} onChange={e => setForm({ ...form, ContactPerson: e.target.value })} placeholder={t('organizations.contactPersonPlaceholder')} />
              </div>
              <div>
                <label className="label">{t('organizations.phoneLabel')}</label>
                <input className="input" type="tel" value={form.Phone} onChange={e => setForm({ ...form, Phone: e.target.value })} placeholder={t('organizations.phonePlaceholder')} />
              </div>
            </div>
            <div>
              <label className="label">{t('organizations.emailLabel')}</label>
              <input className="input" type="email" value={form.Email} onChange={e => setForm({ ...form, Email: e.target.value })} placeholder={t('organizations.emailPlaceholder')} />
            </div>
            <div>
              <label className="label">{t('organizations.addressLabel')}</label>
              <textarea className="input" rows={2} value={form.Address} onChange={e => setForm({ ...form, Address: e.target.value })} placeholder={t('organizations.addressPlaceholder')} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeForm} className="btn-secondary">{t('organizations.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('organizations.saving') : t('organizations.addOrgButton')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ───── Tab 3: Parties ───────────────────────────────────── */
const PARTY_INIT = {
  PartyName: '', GroupId: '', OrganizationId: '',
  ContactNo: '', Email: '', Address: '', DefaultCommissionPercent: '',
};

function PartiesTab() {
  const { t } = useTranslation('marketing');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(PARTY_INIT);
  const queryClient = useQueryClient();

  const { data: partiesData, isLoading: loading } = useApiQuery<{ Results?: Party[] } & Party[]>(
    queryKeys.marketingReferral.parties(),
    '/api/marketing-referral/parties',
  );
  const items: Party[] = (partiesData as { Results?: Party[] })?.Results ?? (Array.isArray(partiesData) ? partiesData : []);

  const { data: orgsData } = useApiQuery<{ Results?: OrgOption[] } & OrgOption[]>(
    queryKeys.marketingReferral.organizations(),
    '/api/marketing-referral/organizations',
  );
  const orgs: OrgOption[] = (orgsData as { Results?: OrgOption[] })?.Results ?? (Array.isArray(orgsData) ? orgsData : []);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.marketingReferral.parties() });
  };
  const closeForm = () => { setShowForm(false); setForm(PARTY_INIT); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.post('/api/marketing-referral/parties', {
        PartyName: form.PartyName,
        GroupId: form.GroupId ? parseInt(form.GroupId) : undefined,
        OrganizationId: form.OrganizationId ? parseInt(form.OrganizationId) : undefined,
        ContactNo: form.ContactNo || undefined,
        Email: form.Email || undefined,
        Address: form.Address || undefined,
        DefaultCommissionPercent: form.DefaultCommissionPercent
          ? Number(form.DefaultCommissionPercent)
          : undefined,
      });
      toast.success(t('parties.toast.added'));
      closeForm(); invalidate();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? t('parties.toast.saveFailed'));
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--color-text-muted)]">
          {t('parties.count', { count: items.length })}
        </p>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> {t('parties.addParty')}
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('parties.partyName')}</th>
                <th>{t('parties.group')}</th>
                <th>{t('parties.organization')}</th>
                <th>{t('parties.commissionPercent')}</th>
                <th>{t('parties.contact')}</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? <SkeletonRows cols={6} />
                : items.length === 0
                  ? (
                    <tr>
                      <td colSpan={6}>
                        <EmptyState
                          icon={<Users className="w-8 h-8 text-[var(--color-text-muted)]" />}
                          title={t('parties.noPartiesYet')}
                          description={t('parties.noPartiesDesc')}
                        />
                      </td>
                    </tr>
                  )
                  : items.map((p, i) => (
                    <tr key={p.PartyId ?? i}>
                      <td className="text-[var(--color-text-muted)]">{i + 1}</td>
                      <td className="font-medium">{p.PartyName}</td>
                      <td className="text-[var(--color-text-secondary)]">{p.GroupName || '—'}</td>
                      <td className="text-[var(--color-text-secondary)]">{p.OrganizationName || '—'}</td>
                      <td className="font-data">
                        <span className="badge-neutral">{p.DefaultCommissionPercent ?? 0}%</span>
                      </td>
                      <td className="text-sm text-[var(--color-text-muted)]">{p.ContactNo || '—'}</td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <Modal title={t('parties.addPartyTitle')} onClose={closeForm}>
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className="label">{t('parties.partyNameLabel')}</label>
              <input className="input" required value={form.PartyName} onChange={e => setForm({ ...form, PartyName: e.target.value })} placeholder={t('parties.partyNamePlaceholder')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">{t('parties.groupIdLabel')}</label>
                <input className="input" type="number" value={form.GroupId} onChange={e => setForm({ ...form, GroupId: e.target.value })} placeholder={t('parties.groupIdPlaceholder')} />
              </div>
              <div>
                <label className="label">{t('parties.organizationLabel')}</label>
                <select className="input" value={form.OrganizationId} onChange={e => setForm({ ...form, OrganizationId: e.target.value })}>
                  <option value="">{t('parties.none')}</option>
                  {orgs.map(o => (
                    <option key={o.OrganizationId} value={o.OrganizationId}>{o.OrganizationName}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">{t('parties.contactNoLabel')}</label>
                <input className="input" type="tel" value={form.ContactNo} onChange={e => setForm({ ...form, ContactNo: e.target.value })} placeholder={t('parties.contactNoPlaceholder')} />
              </div>
              <div>
                <label className="label">{t('parties.defaultCommissionLabel')}</label>
                <input className="input" type="number" min="0" max="100" step="0.01" value={form.DefaultCommissionPercent} onChange={e => setForm({ ...form, DefaultCommissionPercent: e.target.value })} placeholder={t('parties.commissionPlaceholder')} />
              </div>
            </div>
            <div>
              <label className="label">{t('parties.emailLabel')}</label>
              <input className="input" type="email" value={form.Email} onChange={e => setForm({ ...form, Email: e.target.value })} placeholder={t('parties.emailPlaceholder')} />
            </div>
            <div>
              <label className="label">{t('parties.addressLabel')}</label>
              <textarea className="input" rows={2} value={form.Address} onChange={e => setForm({ ...form, Address: e.target.value })} placeholder={t('parties.addressPlaceholder')} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeForm} className="btn-secondary">{t('parties.cancel')}</button>
              <button type="submit" disabled={saving} className="btn-primary">{saving ? t('parties.saving') : t('parties.addPartyButton')}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

/* ───── Tab 4: Report ────────────────────────────────────── */
function ReportTab() {
  const { t } = useTranslation('marketing');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState(MONTH_AGO);
  const [toDate, setToDate] = useState(TODAY);
  const [partyId, setPartyId] = useState('');
  const [hasGenerated, setHasGenerated] = useState(false);

  // Load parties for filter
  const { data: partiesRaw } = useApiQuery<{ Results?: PartyOption[] } & PartyOption[]>(
    queryKeys.marketingReferral.parties(),
    '/api/marketing-referral/parties',
  );
  const parties: PartyOption[] = (partiesRaw as { Results?: PartyOption[] })?.Results ?? (Array.isArray(partiesRaw) ? partiesRaw : []);

  const generate = async () => {
    if (!fromDate || !toDate) { toast.error(t('report.toast.selectDates')); return; }
    setLoading(true); setHasGenerated(true);
    try {
      const params = new URLSearchParams({ fromDate, toDate });
      if (partyId) params.set('partyId', partyId);
      const data = await api.get<{ Results?: ReportRow[] } & ReportRow[]>(
        `/api/marketing-referral/report?${params.toString()}`
      );
      setRows((data as { Results?: ReportRow[] })?.Results ?? (Array.isArray(data) ? data : []));
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message ?? t('report.toast.failed'));
      setRows([]);
    } finally { setLoading(false); }
  };

  const totals = rows.reduce(
    (acc, r) => ({
      txns: acc.txns + (r.TotalTransactions || 0),
      bill: acc.bill + (r.TotalBillAmount || 0),
      comm: acc.comm + (r.TotalCommission || 0),
    }),
    { txns: 0, bill: 0, comm: 0 },
  );

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">{t('report.fromDate')}</label>
          <input className="input w-36" type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="label">{t('report.toDate')}</label>
          <input className="input w-36" type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        <div className="flex-1 min-w-44">
          <label className="label">{t('report.partyOptional')}</label>
          <select className="input" value={partyId} onChange={e => setPartyId(e.target.value)}>
            <option value="">{t('report.allParties')}</option>
            {parties.map(p => (
              <option key={p.PartyId} value={p.PartyId}>{p.PartyName}</option>
            ))}
          </select>
        </div>
        <button onClick={generate} disabled={loading} className="btn-primary self-end">
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart2 className="w-4 h-4" />}
          {loading ? t('report.generating') : t('report.generateReport')}
        </button>
      </div>

      {/* Results */}
      {hasGenerated && (
        <>
          {rows.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="card p-4">
                <p className="text-sm text-[var(--color-text-muted)]">{t('report.totalTransactions')}</p>
                <p className="text-2xl font-bold font-data mt-1">{totals.txns.toLocaleString()}</p>
              </div>
              <div className="card p-4">
                <p className="text-sm text-[var(--color-text-muted)]">{t('report.totalBillAmount')}</p>
                <p className="text-2xl font-bold font-data mt-1">৳{totals.bill.toLocaleString()}</p>
              </div>
              <div className="card p-4">
                <p className="text-sm text-[var(--color-text-muted)]">{t('report.totalCommission')}</p>
                <p className="text-2xl font-bold font-data mt-1 text-emerald-600">
                  ৳{totals.comm.toLocaleString()}
                </p>
              </div>
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('report.partyName')}</th>
                    <th>{t('report.organization')}</th>
                    <th className="text-right">{t('report.transactions')}</th>
                    <th className="text-right">{t('report.billAmount')}</th>
                    <th className="text-right">{t('report.commission')}</th>
                    <th className="text-right">{t('report.avgCommission')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? <SkeletonRows cols={7} />
                    : rows.length === 0
                      ? (
                        <tr>
                          <td colSpan={7}>
                            <EmptyState
                              icon={<BarChart2 className="w-8 h-8 text-[var(--color-text-muted)]" />}
                              title={t('report.noReportData')}
                              description={t('report.noReportDataDesc')}
                            />
                          </td>
                        </tr>
                      )
                      : rows.map((r, i) => (
                        <tr key={i}>
                          <td className="text-[var(--color-text-muted)]">{i + 1}</td>
                          <td className="font-medium">{r.PartyName}</td>
                          <td className="text-[var(--color-text-secondary)]">{r.OrganizationName || '—'}</td>
                          <td className="font-data text-right">{r.TotalTransactions.toLocaleString()}</td>
                          <td className="font-data text-right">৳{r.TotalBillAmount.toLocaleString()}</td>
                          <td className="font-data text-right text-emerald-600 font-medium">
                            ৳{r.TotalCommission.toLocaleString()}
                          </td>
                          <td className="font-data text-right">
                            <span className="badge-neutral">{r.AvgCommissionPercent?.toFixed(1)}%</span>
                          </td>
                        </tr>
                      ))
                  }
                  {!loading && rows.length > 0 && (
                    <tr className="font-semibold bg-[var(--color-bg-secondary)]">
                      <td colSpan={3} className="text-right text-[var(--color-text-muted)] text-sm">
                        {t('report.totals')}
                      </td>
                      <td className="font-data text-right">{totals.txns.toLocaleString()}</td>
                      <td className="font-data text-right">৳{totals.bill.toLocaleString()}</td>
                      <td className="font-data text-right text-emerald-600">
                        ৳{totals.comm.toLocaleString()}
                      </td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ───── Tab map ──────────────────────────────────────────── */
const TAB_MAP: Record<string, React.ComponentType> = {
  schemes: SchemesTab,
  organizations: OrganizationsTab,
  parties: PartiesTab,
  report: ReportTab,
};

/* ───── Main page ────────────────────────────────────────── */
export default function MarketingReferral({ role }: { role?: string }) {
  const { t } = useTranslation('marketing');
  const [activeTab, setActiveTab] = useState('schemes');
  const TabComponent = TAB_MAP[activeTab];

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title')}</h1>
              <p className="section-subtitle">{t('subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-[var(--color-primary)] text-white shadow-sm'
                    : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                }`}
              >
                <Icon className="w-4 h-4" />{t(`tabs.${tab.key}`)}
              </button>
            );
          })}
        </div>

        <TabComponent />
      </div>
    </DashboardLayout>
  );
}

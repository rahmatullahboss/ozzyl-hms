import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Users, Search, Plus, Eye, Pencil, Download, Filter, RefreshCw } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { getRoleBasePath } from '../lib/handover';

interface Patient {
  id: number;
  name: string;
  father_husband: string;
  address: string;
  mobile: string;
  guardian_mobile: string;
  age?: number;
  gender?: string;
  created_at: string;
}

function parsePatientDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function PatientList({ role = 'hospital_admin' }: { role?: string }) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const perPage = 20;
  const navigate = useNavigate();
  const { t } = useTranslation(['patients', 'common']);

  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = getRoleBasePath(slug, role);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const today = new Date().toDateString();
  const formatPatientDate = (value?: string | null) => {
    const date = parsePatientDate(value);
    return date ? date.toLocaleDateString('en-GB') : '—';
  };

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/patients', {
        params: { search, page, perPage },
        headers: { Authorization: `Bearer ${token}` },
      });
      setPatients(data.patients || []);
      setTotal(data.total ?? data.patients?.length ?? 0);
    } catch {
      setPatients([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { fetchPatients(); }, [fetchPatients]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Page Header ── */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title')}</h1>
            <nav className="text-sm text-[var(--color-text-muted)] mt-1">
              <span>{t('dashboard', { ns: 'dashboard', defaultValue: 'Dashboard' })}</span> <span className="mx-1.5">›</span> <span className="text-[var(--color-text-secondary)]">{t('title')}</span>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchPatients} className="btn-ghost" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
            <button className="btn-secondary">
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">{t('export', { ns: 'common', defaultValue: 'Export' })}</span>
            </button>
            <button onClick={() => navigate(`${basePath}/patients/new`)} className="btn-primary">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t('newPatient')}</span>
            </button>
          </div>
        </div>

        {/* ── Summary chips ── */}
        <div className="flex flex-wrap gap-2">
          <span className="badge badge-primary">{t('total', { ns: 'common' })}: {total.toLocaleString()}</span>
          <span className="badge badge-info">{t('today', { ns: 'common', defaultValue: 'Today' })}: {loading ? '…' : patients.filter(p => {
            const date = parsePatientDate(p.created_at);
            return date ? date.toDateString() === today : false;
          }).length}</span>
        </div>

        {/* ── Search & Filter ── */}
        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder={t('search', { ns: 'common' })}
              value={search}
              onChange={(e) => {
                const v = e.target.value;
                setSearch(v);
                setPage(1);
                clearTimeout(searchTimer.current);
                searchTimer.current = setTimeout(() => fetchPatients(), 350);
              }}
              className="input pl-9"
            />
          </div>
          <button className="btn-secondary"><Filter className="w-4 h-4" /> {t('filter', { ns: 'common', defaultValue: 'Filter' })}</button>
        </div>

        {/* ── Table / Card List ── */}
        <div className="card overflow-hidden">

          {/* Mobile card list — visible on small screens */}
          <div className="sm:hidden divide-y divide-[var(--color-border)]">
            {loading
              ? [...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-4">
                    <div className="skeleton w-10 h-10 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-4 w-32" />
                      <div className="skeleton h-3 w-20" />
                    </div>
                    <div className="skeleton h-3 w-14" />
                  </div>
                ))
              : patients.length === 0 ? (
                  <div className="py-16 flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
                    <Users className="w-10 h-10 opacity-30" />
                    <p className="font-medium">{t('noPatients', { defaultValue: 'No patients found' })}</p>
                    <button onClick={() => navigate(`${basePath}/patients/new`)} className="btn-primary">
                      <Plus className="w-4 h-4" /> {t('addFirst', { defaultValue: 'Add First Patient' })}
                    </button>
                  </div>
                )
              : patients.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 p-4 cursor-pointer hover:bg-[var(--color-border-light)] transition-colors"
                    onClick={() => navigate(`${basePath}/patients/${p.id}`)}
                  >
                    <div className={`mobile-card-avatar shrink-0 ${
                      p.gender === 'Female'
                        ? 'bg-pink-50 text-pink-600'
                        : 'bg-blue-50 text-blue-600'
                    }`}>
                      {p.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{p.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)] font-data">
                        P-{String(p.id).padStart(4, '0')}
                        {p.age ? ` · ${p.age}` : ''}{p.gender ? `/${p.gender[0]}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {formatPatientDate(p.created_at)}
                      </p>
                      <div className="flex gap-1 justify-end mt-1">
                        <button onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/patients/${p.id}`); }} className="btn-ghost p-1" title="View"><Eye className="w-3.5 h-3.5" /></button>
                        <button onClick={(e) => { e.stopPropagation(); navigate(`${basePath}/patients/new?edit=${p.id}`); }} className="btn-ghost p-1" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  </div>
                ))
            }
          </div>

          {/* Desktop table — hidden on mobile */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('patientId')}</th>
                  <th>{t('name', { ns: 'common' })}</th>
                  <th>{t('age')} / {t('gender')}</th>
                  <th>{t('phone', { ns: 'common' })}</th>
                  <th>{t('date', { ns: 'common' })}</th>
                  <th>{t('actions', { ns: 'common' })}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(7)].map((_, j) => (
                        <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : patients.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-3 text-[var(--color-text-muted)]">
                        <Users className="w-10 h-10 opacity-30" />
                        <p className="font-medium">{t('noPatients', { defaultValue: 'No patients found' })}</p>
                        <button onClick={() => navigate(`${basePath}/patients/new`)} className="btn-primary">
                          <Plus className="w-4 h-4" /> {t('addFirst', { defaultValue: 'Add First Patient' })}
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  patients.map((p, idx) => (
                    <tr key={p.id}>
                      <td className="text-[var(--color-text-muted)]">{(page - 1) * perPage + idx + 1}</td>
                      <td className="font-data font-medium text-[var(--color-primary-dark)]">P-{String(p.id).padStart(4, '0')}</td>
                      <td className="font-medium">{p.name}</td>
                      <td className="text-[var(--color-text-secondary)]">
                        {p.age ? `${p.age}` : '—'}{p.gender ? ` / ${p.gender[0]}` : ''}
                      </td>
                      <td className="font-data text-sm">{p.mobile}</td>
                      <td className="text-sm text-[var(--color-text-muted)]">
                        {formatPatientDate(p.created_at)}
                      </td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => navigate(`${basePath}/patients/${p.id}`)}
                            className="btn-ghost p-1.5" title="View"
                          ><Eye className="w-4 h-4" /></button>
                          <button
                            onClick={() => navigate(`${basePath}/patients/new?edit=${p.id}`)}
                            className="btn-ghost p-1.5" title="Edit"
                          ><Pencil className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!loading && patients.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
              <span className="text-sm text-[var(--color-text-muted)]">
                {t('showing', { defaultValue: 'Showing' })} {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} {t('of', { defaultValue: 'of' })} {total.toLocaleString()} {t('patientsList', { defaultValue: 'patients' })}
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="btn-ghost text-sm disabled:opacity-40"
                >← {t('prev', { ns: 'common', defaultValue: 'Prev' })}</button>
                {[...Array(Math.min(5, totalPages))].map((_, i) => {
                  const pg = i + 1;
                  return (
                    <button key={pg} onClick={() => setPage(pg)}
                      className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                        pg === page ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                      }`}>
                      {pg}
                    </button>
                  );
                })}
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="btn-ghost text-sm disabled:opacity-40"
                >{t('next', { ns: 'common', defaultValue: 'Next' })} →</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}

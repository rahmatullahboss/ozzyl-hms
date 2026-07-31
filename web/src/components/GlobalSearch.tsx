import { useState, useEffect, useRef } from 'react';
import { useApiQuery } from '../hooks/useApiQuery';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Search,
  User,
  Receipt,
  Stethoscope,
  Bed,
  Loader2,
  X,
  Printer,
  Eye,
  Info,
} from 'lucide-react';
import { getTenant, useAuth } from '../hooks/useAuth';

interface SearchResult {
  data: {
    query: string;
    patients: { id: number; name: string; phone: string; patient_code: string }[];
    bills: {
      id: number;
      invoice_no: string;
      patient_id: number;
      patient_name?: string;
      patient_code?: string;
      total: number;
      paid?: number;
      status: string;
      created_at?: string;
    }[];
    doctors: { id: number; name: string; phone: string }[];
    admissions: { id: number; patient_id: number; patient_name: string; bed_number: string; status: string }[];
    totalResults: number;
  };
}

// `bills.total` is stored in TAKA (REAL), not paisa — format with locale separators.
const fmtTaka = (amount: number, lang: string) => {
  const n = Number(amount) || 0;
  return `৳${new Intl.NumberFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n)}`;
};

// Status badge color map matches BillingDashboard semantics.
const statusClass = (status: string) => {
  const s = (status || '').toLowerCase();
  if (s === 'paid' || s === 'completed') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
  if (s === 'partial' || s === 'partially_paid') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  if (s === 'cancelled' || s === 'void') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300';
  if (s === 'open' || s === 'unpaid' || s === 'due') return 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200';
};

// Looks like the user is typing an invoice query?
const looksLikeInvoice = (q: string) => /^(inv|bl|opd|ipd|lab|ph|rx)[-\s]?/i.test(q.trim()) || /^[\d\s,;]+$/.test(q.trim());

export default function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { i18n } = useTranslation();
  const slug = getTenant()?.slug ?? '';
  const { user } = useAuth();
  const role = user?.role ?? 'hospital_admin';

  // Reception users have their own billing route prefix.
  const billPrintPath = (billId: number) =>
    role === 'reception' ? `reception/billing/${billId}/print` : `billing/${billId}/print`;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Lock body scroll while overlay is open so the page below stops fighting
  // for attention. This is also a small UX polish vs. the prior implementation.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  const { data, isLoading } = useApiQuery<SearchResult>(
    ['global-search', debouncedQuery],
    `/api/search?q=${encodeURIComponent(debouncedQuery)}`,
    { enabled: debouncedQuery.length >= 2 && isOpen },
  );

  const results = data?.data;
  const hasResults = results && results.totalResults > 0;
  const lang = i18n.language?.startsWith('bn') ? 'bn' : 'en';

  const t = (en: string, bn: string) => (lang === 'bn' ? bn : en);

  const handleNavigate = (path: string) => {
    setIsOpen(false);
    setQuery('');
    navigate(`/h/${slug}/${path}`);
  };

  const handlePrintInvoice = (e: React.MouseEvent, billId: number) => {
    e.stopPropagation();
    // Open print page in a new tab so user keeps their workflow.
    const url = `/h/${slug}/${billPrintPath(billId)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!isOpen) {
    return (
      <button
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)] transition-colors text-sm text-[var(--color-text-muted)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        onClick={() => setIsOpen(true)}
        aria-label={t('Open global search', 'গ্লোবাল সার্চ খুলুন')}
      >
        <Search className="w-4 h-4" />
        <span className="hidden md:inline">{t('Search…', 'সার্চ…')}</span>
        <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg)] border border-[var(--color-border)] font-mono">⌘K</kbd>
      </button>
    );
  }

  const placeholder = t(
    'Search patients, INV-numbers, doctors…',
    'রোগী, INV-নম্বর, ডাক্তার খুঁজুন…',
  );

  const showNoResultsHint = debouncedQuery.length >= 2 && !isLoading && !hasResults && looksLikeInvoice(debouncedQuery);

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-sm flex items-start justify-center pt-2 px-4"
      onClick={() => setIsOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label={t('Global search', 'গ্লোবাল সার্চ')}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl border border-slate-200 dark:border-slate-700 ring-1 ring-black/5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Search input ── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <Search className="w-5 h-5 text-[var(--color-text-muted)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 outline-none bg-transparent text-base sm:text-lg text-[var(--color-text)] placeholder:text-slate-400"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-muted)]" />}
          <button
            className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            onClick={() => setIsOpen(false)}
            aria-label={t('Close', 'বন্ধ করুন')}
          >
            <X className="w-4 h-4 text-[var(--color-text-muted)]" />
          </button>
        </div>

        {/* ── Results ── */}
        <div className="max-h-[60vh] overflow-y-auto">
          {debouncedQuery.length < 2 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-[var(--color-text-muted)]">
                {t('Type at least 2 characters to search', 'অনুসন্ধানের জন্য কমপক্ষে 2টি অক্ষর টাইপ করুন')}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5 justify-center text-[11px] text-slate-400">
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800">
                  {t('Patient name', 'রোগীর নাম')}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800">
                  {t('Mobile number', 'মোবাইল নম্বর')}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono">INV-000023</span>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800">
                  {t('Doctor name', 'ডাক্তারের নাম')}
                </span>
              </div>
            </div>
          ) : !hasResults ? (
            <div className="px-4 py-10 text-center space-y-3">
              <p className="text-sm text-[var(--color-text-muted)]">
                {t('No results found for', 'কোনো ফলাফল পাওয়া যায়নি')} <span className="font-mono text-[var(--color-text)]">&ldquo;{debouncedQuery}&rdquo;</span>
              </p>
              {showNoResultsHint && (
                <div className="mx-auto max-w-md text-left rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30 p-3 flex gap-2">
                  <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                    {t(
                      'Tip: Invoice numbers use digits (zero), not the letter "o". Try',
                      'টিপ: ইনভয়েস নম্বরে ইংরেজি "o" নয়, শূন্য (0) ব্যবহার করুন। চেষ্টা করুন',
                    )}{' '}
                    <span className="font-mono font-semibold">
                      {debouncedQuery.replace(/o/gi, '0').toUpperCase()}
                    </span>
                    {' '}{t('or just the number, e.g.', 'অথবা শুধু সংখ্যা, যেমন')} <span className="font-mono font-semibold">23</span>.
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-2 space-y-3">
              {results.patients.length > 0 && (
                <section>
                  <h4 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide px-2 py-1 flex items-center gap-1.5">
                    <User className="w-3 h-3" /> {t('Patients', 'রোগী')} ({results.patients.length})
                  </h4>
                  {results.patients.map((p) => (
                    <button
                      key={`patient-${p.id}`}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between transition-colors group"
                      onClick={() => handleNavigate(`patients/${p.id}`)}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--color-text)] truncate">{p.name}</p>
                        <p className="text-xs text-[var(--color-text-muted)] font-mono">{p.patient_code} · {p.phone}</p>
                      </div>
                      <Eye className="w-4 h-4 text-slate-300 group-hover:text-[var(--color-primary)] shrink-0" />
                    </button>
                  ))}
                </section>
              )}

              {results.bills.length > 0 && (
                <section>
                  <h4 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide px-2 py-1 flex items-center gap-1.5">
                    <Receipt className="w-3 h-3" /> {t('Invoices', 'ইনভয়েস')} ({results.bills.length})
                  </h4>
                  {results.bills.map((b) => {
                    const due = (Number(b.total) || 0) - (Number(b.paid) || 0);
                    return (
                      <div
                        key={`bill-${b.id}`}
                        role="button"
                        tabIndex={0}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-between gap-3 transition-colors cursor-pointer"
                        onClick={() => handleNavigate(billPrintPath(b.id))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleNavigate(billPrintPath(b.id));
                          }
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold font-mono text-[var(--color-text)] text-sm">{b.invoice_no || `#${b.id}`}</p>
                            <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-md ${statusClass(b.status)}`}>
                              {b.status}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                            {b.patient_name ? (
                              <>
                                <span className="text-[var(--color-text)]">{b.patient_name}</span>
                                {b.patient_code && <span className="font-mono"> · {b.patient_code}</span>}
                              </>
                            ) : (
                              <span>{t('Patient', 'রোগী')} #{b.patient_id}</span>
                            )}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-[var(--color-text)] font-data">{fmtTaka(b.total, lang)}</p>
                          {due > 0 && (
                            <p className="text-[11px] text-rose-600 dark:text-rose-400 font-data">
                              {t('Due', 'বাকি')}: {fmtTaka(due, lang)}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-[var(--color-primary)] hover:text-white hover:border-[var(--color-primary)] transition-colors cursor-pointer"
                          onClick={(e) => handlePrintInvoice(e, b.id)}
                          aria-label={t('Print invoice', 'ইনভয়েস প্রিন্ট করুন')}
                          title={t('Open print preview in new tab', 'নতুন ট্যাবে প্রিন্ট প্রিভিউ খুলুন')}
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{t('Print', 'প্রিন্ট')}</span>
                        </button>
                      </div>
                    );
                  })}
                </section>
              )}

              {results.doctors.length > 0 && (
                <section>
                  <h4 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide px-2 py-1 flex items-center gap-1.5">
                    <Stethoscope className="w-3 h-3" /> {t('Doctors', 'ডাক্তার')} ({results.doctors.length})
                  </h4>
                  {results.doctors.map((d) => (
                    <button
                      key={`doctor-${d.id}`}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      onClick={() => handleNavigate(`doctors/${d.id}`)}
                    >
                      <p className="font-medium text-[var(--color-text)]">{d.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)] font-mono">{d.phone}</p>
                    </button>
                  ))}
                </section>
              )}

              {results.admissions.length > 0 && (
                <section>
                  <h4 className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide px-2 py-1 flex items-center gap-1.5">
                    <Bed className="w-3 h-3" /> {t('Admissions', 'ভর্তি')} ({results.admissions.length})
                  </h4>
                  {results.admissions.map((a) => (
                    <button
                      key={`admission-${a.id}`}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      onClick={() => handleNavigate(`ipd/${a.id}`)}
                    >
                      <p className="font-medium text-[var(--color-text)]">{a.patient_name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {t('Bed', 'বেড')} {a.bed_number} · {a.status}
                      </p>
                    </button>
                  ))}
                </section>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-2 text-[11px] text-[var(--color-text-muted)] flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
          <span>{results?.totalResults || 0} {t('results', 'ফলাফল')}</span>
          <span className="hidden sm:inline">
            <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono">ESC</kbd> {t('to close', 'বন্ধ করতে')} · <kbd className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono">↵</kbd> {t('to open', 'খুলতে')}
          </span>
          <span className="sm:hidden">ESC</span>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useId, useRef } from 'react';
import { X, Search, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../hooks/useApiQuery';

export function DeskStat({ label, value, loading, icon, tone }: {
  label: string;
  value: number | string;
  loading?: boolean;
  icon: React.ReactNode;
  tone: 'blue' | 'violet' | 'amber' | 'emerald';
}) {
  const toneClass = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    violet: 'bg-violet-50 text-violet-700 border-violet-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  }[tone];

  return (
    <div className={`rounded-lg border p-4 ${toneClass}`}>
      <div className="mb-3 flex items-center justify-between">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</span>
      </div>
      {loading ? <div className="skeleton h-8 w-16 rounded" /> : <div className="font-data text-3xl font-bold leading-none">{value}</div>}
    </div>
  );
}

export function Modal({ title, children, onClose, size = 'default' }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  size?: 'default' | 'wide';
}) {
  const widthClass = size === 'wide' ? 'max-w-7xl' : 'max-w-4xl';
  const titleId = useId();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 pt-12 z-50 backdrop-blur-sm overflow-y-auto">
      <div
        className={`bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full ${widthClass} mb-8`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <h3 id={titleId} className="font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label="Close dialog">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function LabTestSelector({ selected, onChange, formatBDT }: { selected: number[]; onChange: (ids: number[]) => void; formatBDT: (n: number) => string }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { t } = useTranslation(['billing', 'common', 'patients', 'sidebar']);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Fetch frequently used lab service items (already sorted by usage_count DESC)
  const { data: frequentData } = useApiQuery<{ services: Array<{ id: number; item_name: string; price: number; usage_count?: number }> }>(
    ['reception', 'frequent-lab'],
    '/api/reception/services?is_lab_catalog=1&limit=8',
    { staleTime: 300_000 },
  );
  const frequentTests = (frequentData?.services ?? []).slice(0, 8);

  const { data, isLoading } = useApiQuery<{ tests: Array<{ id: number; name: string; price: number; category?: string }> }>(
    ['lab', 'catalog', debouncedSearch],
    debouncedSearch.length >= 2 ? `/api/lab?search=${encodeURIComponent(debouncedSearch)}` : '',
    { enabled: debouncedSearch.length >= 2 },
  );
  const tests = data?.tests ?? [];

  const toggle = (id: number) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };

  return (
    <div>
      {/* Frequently Used Tests */}
      {frequentTests.length > 0 && !debouncedSearch && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-1.5">
            {t('frequentTests', { defaultValue: 'Frequently Used' })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {frequentTests.map(test => (
              <button
                key={test.id}
                type="button"
                onClick={() => toggle(test.id)}
                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  selected.includes(test.id)
                    ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)]'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
                }`}
              >
                {test.item_name} <span className="opacity-70">({formatBDT(test.price)})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-2">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
        <input
          className="input pl-9"
          placeholder={t('searchTests', { defaultValue: 'Search lab tests...' })}
          aria-label={t('searchTests', { defaultValue: 'Search lab tests...' })}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Search Results */}
      {isLoading ? (
        <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">{t('loading', { defaultValue: 'Loading...' })}</div>
      ) : tests.length === 0 ? (
        <div className="p-4 text-center text-sm text-[var(--color-text-muted)]">{debouncedSearch.length >= 2 ? t('noTestsFound', { defaultValue: 'No tests found' }) : t('searchMinChars', { defaultValue: 'Type at least 2 characters to search' })}</div>
      ) : (
        tests.map(test => (
          <button key={test.id} onClick={() => toggle(test.id)}
            className={`w-full text-left px-3 py-2 flex justify-between items-center hover:bg-[var(--color-border-light)] border-b border-[var(--color-border)] last:border-0 ${selected.includes(test.id) ? 'bg-[var(--color-primary-light)]' : ''}`}>
            <div className="flex items-center gap-2">
              <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected.includes(test.id) ? 'bg-[var(--color-primary)] border-[var(--color-primary)]' : 'border-[var(--color-border)]'}`}>
                {selected.includes(test.id) && <CheckCircle2 className="w-3 h-3 text-white" />}
              </div>
              <span className="text-sm">{test.name}</span>
              <span className="text-xs text-[var(--color-text-muted)]">{test.category}</span>
            </div>
            <span className="font-data text-sm">{formatBDT(test.price)}</span>
          </button>
        ))
      )}
      {selected.length > 0 && <p className="text-xs text-[var(--color-text-muted)] mt-1">{selected.length} test(s) selected</p>}
    </div>
  );
}

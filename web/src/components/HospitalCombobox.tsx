import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, X, Loader2 } from 'lucide-react';
import { apiFetch } from '../lib/apiClient';

export type HospitalOption = { id: number; name: string };

type HospitalComboboxProps = {
  value: HospitalOption | null;
  onChange: (hospital: HospitalOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

type ReferralHospital = {
  id: number;
  name: string;
  short_code?: string | null;
  is_active?: number;
};

const DEBOUNCE_MS = 300;

export default function HospitalCombobox({
  value,
  onChange,
  placeholder = 'Search referral hospital…',
  disabled = false,
  className = '',
}: HospitalComboboxProps) {
  const [query, setQuery] = useState<string>(value?.name ?? '');
  const [results, setResults] = useState<ReferralHospital[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedValueId = useRef<number | null>(value?.id ?? null);

  useEffect(() => {
    if (value?.id == null) {
      if (lastSyncedValueId.current !== null) {
        setQuery('');
        lastSyncedValueId.current = null;
      }
      return;
    }
    if (value.id !== lastSyncedValueId.current) {
      setQuery(value.name);
      lastSyncedValueId.current = value.id;
    }
  }, [value]);

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (trimmed) params.set('search', trimmed);
      params.set('active', 'true');
      const data = await apiFetch<{ hospitals?: ReferralHospital[] }>(
        `/api/referral-hospitals?${params.toString()}`,
      );
      const active = (data.hospitals ?? []).filter((h) => Number(h.is_active ?? 1) === 1);
      setResults(active);
      setSelectedIdx(-1);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (open) search(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (value?.name) setQuery(value.name);
        else setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [value]);

  const handleSelect = (hospital: ReferralHospital) => {
    onChange({ id: hospital.id, name: hospital.name });
    setQuery(hospital.name);
    lastSyncedValueId.current = hospital.id;
    setOpen(false);
    setResults([]);
  };

  const handleClear = () => {
    onChange(null);
    setQuery('');
    lastSyncedValueId.current = null;
    setOpen(false);
    setResults([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && selectedIdx >= 0) {
      e.preventDefault();
      handleSelect(results[selectedIdx]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  const showClearButton = !disabled && (query.length > 0 || value !== null);
  const listboxId = 'hospital-combobox-listbox';
  const inputId = 'hospital-combobox-input';

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={selectedIdx >= 0 ? `hospital-option-${results[selectedIdx]?.id}` : undefined}
          autoComplete="off"
          disabled={disabled}
          className="input pl-9 pr-9 disabled:opacity-50 disabled:cursor-not-allowed"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (disabled) return;
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {loading && <Loader2 className="w-4 h-4 text-[var(--color-text-muted)] animate-spin" />}
          {showClearButton && !loading && (
            <button
              type="button"
              aria-label="Clear selection"
              onClick={handleClear}
              className="p-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {open && !loading && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-xl shadow-lg max-h-80 overflow-auto"
        >
          {results.map((hospital, i) => (
            <li
              id={`hospital-option-${hospital.id}`}
              key={hospital.id}
              role="option"
              aria-selected={selectedIdx === i}
              onClick={() => handleSelect(hospital)}
              onMouseEnter={() => setSelectedIdx(i)}
              className={`px-3 py-2.5 flex items-start gap-3 cursor-pointer transition-colors border-b border-[var(--color-border)] last:border-0 ${
                selectedIdx === i
                  ? 'bg-[var(--color-bg-hover)]'
                  : 'hover:bg-[var(--color-bg-hover)]'
              }`}
            >
              <Building2 className="w-4 h-4 mt-0.5 text-[var(--color-primary)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{hospital.name}</div>
                {hospital.short_code && (
                  <div className="text-xs text-[var(--color-text-muted)] truncate">
                    {hospital.short_code}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && !loading && results.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-xl shadow-lg p-4 text-center text-sm text-[var(--color-text-muted)]">
          {query.trim()
            ? <>No hospitals found for &ldquo;{query.trim()}&rdquo;</>
            : <>No active referral hospitals. Add one in Billing Master.</>}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Pill } from 'lucide-react';
import axios from 'axios';

interface MasterDrug {
  id: number;
  brand_name: string;
  generic_name?: string;
  company_name?: string;
  form?: string;
  strength?: string;
  price?: string;
  pack_size?: string;
}

interface DrugSearchInputProps {
  onSelect: (drug: MasterDrug) => void;
  placeholder?: string;
  className?: string;
}

export default function DrugSearchInput({ onSelect, placeholder = 'Search medicines… (e.g. Napa, Seclo)', className = '' }: DrugSearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MasterDrug[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get(`/api/pharmacy/master-drugs/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setResults(data.results ?? []);
      setOpen(true);
      setSelectedIdx(-1);
    } catch {
      setResults([]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, search]);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (drug: MasterDrug) => {
    onSelect(drug);
    setQuery('');
    setOpen(false);
    setResults([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && selectedIdx >= 0) {
      e.preventDefault();
      handleSelect(results[selectedIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
        <input
          className="input pl-9 pr-3"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
        />
        {loading && <div className="absolute right-3 top-1/2 -translate-y-1/2"><div className="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" /></div>}
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-xl shadow-lg max-h-80 overflow-auto">
          {results.map((drug, i) => (
            <button
              key={drug.id}
              type="button"
              onClick={() => handleSelect(drug)}
              className={`w-full text-left px-3 py-2.5 flex items-start gap-3 hover:bg-[var(--color-bg-hover)] transition-colors border-b border-[var(--color-border)] last:border-0 ${selectedIdx === i ? 'bg-[var(--color-bg-hover)]' : ''}`}
            >
              <Pill className="w-4 h-4 mt-0.5 text-[var(--color-primary)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{drug.brand_name} <span className="text-[var(--color-text-muted)] font-normal">{drug.strength}</span></div>
                <div className="text-xs text-[var(--color-text-secondary)] truncate">
                  {drug.generic_name && <span className="text-[var(--color-primary)]">{drug.generic_name}</span>}
                  {drug.company_name && <span className="ml-1.5">• {drug.company_name}</span>}
                </div>
                <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  {drug.form}{drug.pack_size ? ` • ${drug.pack_size}` : ''}{drug.price ? ` • ৳${drug.price}` : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && query.length >= 2 && results.length === 0 && !loading && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-xl shadow-lg p-4 text-center text-sm text-[var(--color-text-muted)]">
          No medicines found for "{query}"
        </div>
      )}
    </div>
  );
}

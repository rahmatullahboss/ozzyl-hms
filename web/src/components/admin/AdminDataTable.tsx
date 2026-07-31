import { useState, useMemo, useCallback, useEffect } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Columns3, Download, Search } from 'lucide-react';

export interface DataTableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  className?: string;
  render?: (row: T) => React.ReactNode;
}

interface AdminDataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  searchPlaceholder?: string;
  searchKeys?: string[];
  pageSize?: number;
  onExportExcel?: () => void;
  onExportPdf?: () => void;
  emptyMessage?: string;
  loading?: boolean;
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
}

type SortDir = 'asc' | 'desc' | null;

export default function AdminDataTable<T extends Record<string, unknown>>({
  columns, data, searchPlaceholder = 'Search...', searchKeys = [], pageSize = 20,
  onExportExcel, onExportPdf: _onExportPdf, emptyMessage = 'No data found', loading = false,
  rowKey, onRowClick,
}: AdminDataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [page, setPage] = useState(0);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(() => new Set(columns.map(c => c.key)));
  const [showColPicker, setShowColPicker] = useState(false);

  // Sync visibleCols when columns prop changes
  useEffect(() => {
    setVisibleCols(prev => {
      const keys = new Set(columns.map(c => c.key));
      const next = new Set([...prev].filter(k => keys.has(k)));
      // Add any new columns
      for (const k of keys) next.add(k);
      return next;
    });
  }, [columns]);

  const handleSort = useCallback((key: string) => {
    setSortCol(prevCol => {
      setSortDir(prevDir => {
        if (prevCol === key) {
          if (prevDir === 'asc') return 'desc';
          if (prevDir === 'desc') return null;
          return 'asc';
        }
        return 'asc';
      });
      if (prevCol === key) {
        return prevCol; // keep same column
      }
      return key;
    });
    setPage(0);
  }, []);

  const filtered = useMemo(() => {
    let result = data;
    if (search && searchKeys.length > 0) {
      const lower = search.toLowerCase();
      result = result.filter(row =>
        searchKeys.some(key => {
          const val = row[key];
          return val != null && String(val).toLowerCase().includes(lower);
        })
      );
    }
    if (sortCol && sortDir) {
      result = [...result].sort((a, b) => {
        const av = a[sortCol];
        const bv = b[sortCol];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortDir === 'asc' ? av - bv : bv - av;
        }
        const cmp = String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [data, search, searchKeys, sortCol, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const activeCols = columns.filter(c => visibleCols.has(c.key));

  const toggleCol = (key: string) => {
    setVisibleCols(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size <= 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {searchKeys.length > 0 && (
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              className="input pl-10"
              placeholder={searchPlaceholder}
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
            />
          </div>
        )}
        <div className="flex items-center gap-2 ml-auto">
          {/* Column picker */}
          <div className="relative">
            <button
              onClick={() => setShowColPicker(!showColPicker)}
              className="btn-ghost p-2"
              title="Toggle columns"
              aria-label="Toggle columns"
            >
              <Columns3 className="w-4 h-4" />
            </button>
            {showColPicker && (
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-lg shadow-lg p-2 z-20 min-w-[160px]">
                {columns.map(col => (
                  <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-border-light)] cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={visibleCols.has(col.key)}
                      onChange={() => toggleCol(col.key)}
                      className="rounded"
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          {onExportExcel && (
            <button onClick={onExportExcel} className="btn-ghost p-2" title="Export Excel" aria-label="Export Excel">
              <Download className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {activeCols.map(col => (
                  <th
                    key={col.key}
                    className={`px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase ${col.sortable ? 'cursor-pointer select-none hover:bg-gray-100' : ''} ${col.className ?? ''}`}
                    onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {col.sortable && (
                        sortCol === col.key ? (
                          sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronsUpDown className="w-3 h-3 text-gray-300" />
                        )
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={activeCols.length} className="px-4 py-12 text-center text-sm text-gray-500">
                    {emptyMessage}
                  </td>
                </tr>
              ) : paged.map(row => (
                <tr
                  key={rowKey(row)}
                  className={`hover:bg-gray-50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {activeCols.map(col => (
                    <td key={col.key} className={`px-4 py-3 text-sm ${col.className ?? ''}`}>
                      {col.render ? col.render(row) : String(row[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn-ghost p-1.5 disabled:opacity-30"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2">
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="btn-ghost p-1.5 disabled:opacity-30"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

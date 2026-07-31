import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import HospitalCard from '../../components/marketplace/HospitalCard';
import SearchFilters from '../../components/marketplace/SearchFilters';

const API = import.meta.env.VITE_API_URL || '';

export default function HospitalDirectory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [hospitals, setHospitals] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const fetchHospitals = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '12', ...filters });
      if (q) params.set('q', q);
      const res = await fetch(`${API}/api/v1/marketplace/hospitals?${params}`);
      if (res.ok) {
        const data = await res.json();
        setHospitals(data.hospitals || []);
        setTotal(data.total || 0);
      }
    } catch {
      setHospitals([]);
    } finally {
      setLoading(false);
    }
  }, [q, page, filters]);

  useEffect(() => { fetchHospitals(); }, [fetchHospitals]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearchParams(q ? { q } : {});
  };

  const totalPages = Math.ceil(total / 12);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
            <Link to="/marketplace" className="hover:text-blue-600">Marketplace</Link>
            <span>/</span>
            <span className="text-gray-900 font-medium">Hospitals</span>
          </div>
          <form onSubmit={handleSearch} className="flex gap-2 max-w-xl">
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search hospitals..."
              className="flex-1 px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
              Search
            </button>
          </form>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex gap-6">
          {/* Sidebar filters */}
          <div className="w-56 shrink-0 hidden md:block">
            <SearchFilters
              type="hospitals"
              onFilter={(f: Record<string, string>) => { setFilters(f); setPage(1); }}
            />
          </div>

          {/* Results */}
          <div className="flex-1">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-500">
                {loading ? 'Searching...' : `${total} hospital${total !== 1 ? 's' : ''} found`}
              </p>
            </div>

            {loading ? (
              <div className="flex justify-center py-16">
                <div className="w-7 h-7 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : hospitals.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <p className="text-4xl mb-3">🏥</p>
                <p className="font-medium">No hospitals found</p>
                <p className="text-sm mt-1">Try adjusting your search or filters</p>
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {hospitals.map((h: any) => <HospitalCard key={h.id} hospital={h} />)}
              </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-8">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                >
                  ← Prev
                </button>
                <span className="px-3 py-1.5 text-sm text-gray-600">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-40 hover:bg-gray-50"
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';

interface FilterProps {
  type: 'hospitals' | 'doctors';
  onFilter: (params: Record<string, string>) => void;
}

const SPECIALTIES = [
  'cardiology', 'dermatology', 'ent', 'gastroenterology', 'general medicine',
  'general surgery', 'gynecology', 'neurology', 'oncology', 'ophthalmology',
  'orthopedics', 'pediatrics', 'psychiatry', 'pulmonology', 'urology',
];

const LANGUAGES = ['english', 'bengali', 'hindi', 'arabic', 'urdu'];

export default function SearchFilters({ type, onFilter }: FilterProps) {
  const [specialty, setSpecialty] = useState('');
  const [language, setLanguage] = useState('');
  const [ratingMin, setRatingMin] = useState('');
  const [feeMax, setFeeMax] = useState('');
  const [tenantType, setTenantType] = useState('');

  const applyFilters = () => {
    const params: Record<string, string> = {};
    if (specialty) params.specialty = specialty;
    if (language) params.language = language;
    if (ratingMin) params.rating_min = ratingMin;
    if (feeMax) params.fee_max = String(Number(feeMax) * 100);
    if (tenantType) params.type = tenantType;
    onFilter(params);
  };

  const clearFilters = () => {
    setSpecialty('');
    setLanguage('');
    setRatingMin('');
    setFeeMax('');
    setTenantType('');
    onFilter({});
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <h3 className="font-semibold text-gray-900 text-sm">Filters</h3>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Specialty</label>
        <select
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          className="w-full rounded-lg border border-gray-300 text-sm px-2 py-1.5"
        >
          <option value="">All Specialties</option>
          {SPECIALTIES.map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>
      </div>

      {type === 'doctors' && (
        <>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-lg border border-gray-300 text-sm px-2 py-1.5"
            >
              <option value="">All Languages</option>
              {LANGUAGES.map((l) => (
                <option key={l} value={l} className="capitalize">{l}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1">Max Fee (৳)</label>
            <input
              type="number"
              value={feeMax}
              onChange={(e) => setFeeMax(e.target.value)}
              placeholder="e.g. 2000"
              className="w-full rounded-lg border border-gray-300 text-sm px-2 py-1.5"
            />
          </div>
        </>
      )}

      {type === 'hospitals' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Type</label>
          <select
            value={tenantType}
            onChange={(e) => setTenantType(e.target.value)}
            className="w-full rounded-lg border border-gray-300 text-sm px-2 py-1.5"
          >
            <option value="">All</option>
            <option value="hospital">Hospital</option>
            <option value="chamber">Doctor Chamber</option>
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs text-gray-500 mb-1">Min Rating</label>
        <select
          value={ratingMin}
          onChange={(e) => setRatingMin(e.target.value)}
          className="w-full rounded-lg border border-gray-300 text-sm px-2 py-1.5"
        >
          <option value="">Any</option>
          <option value="4">4+ ★</option>
          <option value="3">3+ ★</option>
          <option value="2">2+ ★</option>
        </select>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={applyFilters}
          className="flex-1 bg-blue-600 text-white text-sm rounded-lg py-2 hover:bg-blue-700 transition-colors"
        >
          Apply
        </button>
        <button
          onClick={clearFilters}
          className="px-3 text-gray-500 text-sm rounded-lg py-2 hover:bg-gray-100 transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

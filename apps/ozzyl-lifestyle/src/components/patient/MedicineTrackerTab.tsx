import { useState, useCallback, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  applySelectedDrugToReminderForm,
  buildMedicineReminderPayload,
  formatReminderLine,
  type MedicineReminderFormState,
} from '../../lib/patient-medicine-reminders';

interface MedicineReminder {
  id: number;
  medicine_name: string;
  dosage: string | null;
  strength: string | null;
  dose_amount: string | null;
  time_slot: string;
  time_label: string | null;
  instruction: string;
  instruction_label: string | null;
  taken_today: boolean;
  taken_at: string | null;
  skipped: boolean;
}

interface WeeklyDay {
  date: string;
  percent: number;
}

const toBn = (n: number): string =>
  n.toString().replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);

const DAY_LABELS_BN = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];

const INSTRUCTION_OPTIONS = [
  { value: 'before_meal', label: 'খালি পেটে খাবেন' },
  { value: 'after_meal', label: 'খাবারের পরে খাবেন' },
  { value: 'with_meal', label: 'খাবারের সাথে খাবেন' },
  { value: 'anytime', label: 'যেকোনো সময়' },
];

export default function MedicineTrackerTab() {
  const [medicines, setMedicines] = useState<MedicineReminder[]>([]);
  const [weeklyData, setWeeklyData] = useState<WeeklyDay[]>([]);
  const [weeklyAvg, setWeeklyAvg] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  
  // Autocomplete state
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [formData, setFormData] = useState<MedicineReminderFormState>({
    name: '',
    strength: '',
    doseAmount: '',
    timeBn: '',
    timeSlot: '08:00',
    instruction: 'after_meal',
  });

  // Fetch reminders + weekly data
  const fetchData = useCallback(async () => {
    try {
      const [remindersRes, weeklyRes] = await Promise.all([
        fetch('/api/patient-phr/medicine-reminders', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/patient-phr/medicine-adherence/weekly', { credentials: 'include', cache: 'no-store' }),
      ]);

      if (remindersRes.ok) {
        const data = await remindersRes.json() as { reminders?: MedicineReminder[] };
        setMedicines(data.reminders ?? []);
      }

      if (weeklyRes.ok) {
        const data = await weeklyRes.json() as { weekly?: { days: WeeklyDay[]; avg: number } };
        if (data.weekly) {
          setWeeklyData(data.weekly.days ?? []);
          setWeeklyAvg(data.weekly.avg ?? 0);
        }
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Click outside to close dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearchMedicine = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/patient-phr/master-drugs/search?q=${encodeURIComponent(q)}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results || []);
        setShowDropdown(true);
      }
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleMedicineNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFormData((p) => ({ ...p, name: val }));
    
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => handleSearchMedicine(val), 300);
  };

  const handleSelectMedicine = (drug: any) => {
    setFormData((p) => applySelectedDrugToReminderForm(p, drug));
    setShowDropdown(false);
  };

  const takenCount = medicines.filter((m) => m.taken_today).length;
  const totalCount = medicines.length;
  const adherencePercent = totalCount > 0 ? Math.round((takenCount / totalCount) * 100) : 0;

  // SVG ring math
  const ringR = 80;
  const circumference = 2 * Math.PI * ringR;
  const dashOffset = circumference - (circumference * adherencePercent) / 100;

  const handleMarkTaken = useCallback(async (medId: number) => {
    // Optimistic update
    setMedicines((prev) =>
      prev.map((m) =>
        m.id === medId ? { ...m, taken_today: true, taken_at: new Date().toISOString() } : m,
      ),
    );
    toast.success('✅ ওষুধ নেওয়া হয়েছে!');

    try {
      await fetch(`/api/patient-phr/medicine-reminders/${medId}/take`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Revert on failure
      setMedicines((prev) =>
        prev.map((m) =>
          m.id === medId ? { ...m, taken_today: false, taken_at: null } : m,
        ),
      );
      toast.error('সার্ভারে সমস্যা হয়েছে');
    }
  }, []);

  const handleAddMedicine = useCallback(async () => {
    if (!formData.name || !formData.timeSlot) return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/patient-phr/medicine-reminders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildMedicineReminderPayload(formData)),
      });

      if (res.ok) {
        toast.success('💊 নতুন রিমাইন্ডার যোগ করা হয়েছে!');
        setFormData({ name: '', strength: '', doseAmount: '', timeBn: '', timeSlot: '08:00', instruction: 'after_meal' });
        setShowAddForm(false);
        setSearchResults([]);
        fetchData(); // refresh list
      } else {
        toast.error('রিমাইন্ডার যোগ করা যায়নি');
      }
    } catch {
      toast.error('সার্ভারে সমস্যা হয়েছে');
    }
    setSubmitting(false);
  }, [formData, fetchData]);

  const handleDeleteMedicine = useCallback(async (medId: number) => {
    setMedicines((prev) => prev.filter((m) => m.id !== medId));
    toast.success('রিমাইন্ডার মুছে ফেলা হয়েছে');

    try {
      await fetch(`/api/patient-phr/medicine-reminders/${medId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    } catch { /* silent */ }
  }, []);

  const formatTakenTime = (iso: string | null) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return `${toBn(d.getHours())}:${String(d.getMinutes()).padStart(2, '0').replace(/\d/g, (c) => '০১২৩৪৫৬৭৮৯'[Number(c)])}`;
    } catch { return ''; }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto flex flex-col items-center gap-4 py-20">
        <div className="w-14 h-14 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin" />
        <p className="text-sm text-[#6c7a71] font-medium">ওষুধের তথ্য লোড হচ্ছে...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">

      {/* Hero Adherence Ring */}
      <section className="text-center py-2">
        <h2 className="text-xl font-bold text-[#191c1e] mb-1" style={{ fontFamily: 'Manrope, sans-serif' }}>
          ওষুধের রিমাইন্ডার
        </h2>
        {totalCount > 0 ? (
          <div className="mt-6 flex justify-center items-center relative">
            <svg className="w-48 h-48">
              <circle
                cx="96" cy="96" r={ringR}
                fill="transparent"
                stroke="#e6e8ea"
                strokeWidth="12"
              />
              <circle
                cx="96" cy="96" r={ringR}
                fill="transparent"
                stroke="#006c49"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                style={{ transform: 'rotate(-90deg)', transformOrigin: 'center', transition: 'stroke-dashoffset 0.5s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-extrabold text-[#006c49]" style={{ fontFamily: 'Manrope, sans-serif' }}>
                {toBn(adherencePercent)}%
              </span>
              <span className="text-sm font-medium text-[#6c7a71]">
                আজকে {toBn(takenCount)}/{toBn(totalCount)} সম্পন্ন
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-8 p-8 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl text-center">
            <span className="text-5xl mb-4 block">💊</span>
            <p className="text-[#3c4a42] font-medium mb-4">এখনো কোনো ওষুধের রিমাইন্ডার সেট করা হয়নি</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="px-6 py-3 bg-gradient-to-r from-[#006c49] to-[#10b981] text-white font-bold rounded-xl shadow-md active:scale-95 transition-transform"
            >
              ➕ প্রথম রিমাইন্ডার সেট করুন
            </button>
          </div>
        )}
      </section>

      {/* Medicine Cards */}
      {totalCount > 0 && (
        <div className="space-y-4">
          {medicines.map((med) => (
            <div
              key={med.id}
              className={`bg-white rounded-2xl p-5 shadow-sm flex flex-col gap-3 transition-all hover:shadow-md ${
                !med.taken_today ? 'border-2 border-[#fea619]/20 shadow-lg relative overflow-hidden' : ''
              }`}
            >
              {/* Decorative clock for pending */}
              {!med.taken_today && (
                <div className="absolute top-0 right-0 p-2 opacity-5">
                  <span className="text-6xl text-[#855300]">⏰</span>
                </div>
              )}

              <div className="flex justify-between items-start">
                <div className="space-y-1">
                  <span className={`text-sm font-semibold ${
                    med.taken_today ? 'text-[#6c7a71]' : 'text-[#855300] px-2 py-0.5 bg-[#fea619]/10 rounded'
                  }`}>
                    {med.time_label || med.time_slot}
                  </span>
                  <h3 className="text-lg font-bold text-[#191c1e]">
                    {formatReminderLine(med)}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-3 py-1 rounded-full font-bold flex items-center gap-1 ${
                    med.taken_today
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-[#fea619] text-[#684000]'
                  }`}>
                    {med.taken_today ? '✅ সম্পন্ন' : '⏳ অপেক্ষায়'}
                  </span>
                  <button
                    onClick={() => handleDeleteMedicine(med.id)}
                    className="text-slate-300 hover:text-rose-400 transition-colors p-1"
                    title="মুছুন"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 text-[#3c4a42] text-sm">
                <span>🍽️</span>
                <span>{med.instruction_label || INSTRUCTION_OPTIONS.find((o) => o.value === med.instruction)?.label || ''}</span>
              </div>

              {med.taken_today ? (
                <div className="pt-2 border-t border-dashed border-[#eceef0] flex items-center gap-2 text-xs text-emerald-600 font-medium">
                  <span>✓</span>
                  <span>{formatTakenTime(med.taken_at)} এ নেওয়া হয়েছে</span>
                </div>
              ) : (
                <button
                  onClick={() => handleMarkTaken(med.id)}
                  className="w-full py-3.5 bg-gradient-to-r from-[#006c49] to-[#10b981] text-white font-bold rounded-xl shadow-lg shadow-emerald-500/20 flex justify-center items-center gap-2 active:scale-95 transition-transform"
                >
                  নিয়েছি ✓
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Weekly Summary */}
      {weeklyData.length > 0 && (
        <section className="bg-[#f2f4f6] rounded-2xl p-6">
          <div className="flex justify-between items-center mb-5">
            <h3 className="font-bold text-[#191c1e]" style={{ fontFamily: 'Manrope, sans-serif' }}>
              সাপ্তাহিক সংক্ষিপ্তসার
            </h3>
            <span className="text-[#006c49] font-bold text-sm">
              সাপ্তাহিক গড়: {toBn(weeklyAvg)}%
            </span>
          </div>
          <div className="flex justify-between items-end h-32 gap-2">
            {weeklyData.map((day, i) => {
              const d = new Date(day.date);
              const isToday = day.date === new Date().toISOString().slice(0, 10);
              const height = day.percent > 0 ? `${Math.max(day.percent, 10)}%` : '8%';
              const barColor = day.percent === 0 ? 'bg-[#e0e3e5]' :
                day.percent >= 90 ? 'bg-[#006c49]' :
                day.percent >= 70 ? 'bg-[#006c49]/80' :
                day.percent >= 50 ? 'bg-[#006c49]/60' : 'bg-[#006c49]/40';
              return (
                <div key={i} className="flex flex-col items-center flex-1 gap-2">
                  <div
                    className={`w-full ${barColor} rounded-t-lg transition-all duration-500`}
                    style={{ height }}
                  />
                  <span className={`text-[10px] font-bold ${isToday ? 'text-[#006c49]' : 'text-[#6c7a71]'}`}>
                    {DAY_LABELS_BN[d.getDay()]}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Add Medicine FAB */}
      {totalCount > 0 && (
        <button
          onClick={() => setShowAddForm(true)}
          className="fixed bottom-28 right-6 lg:bottom-8 bg-gradient-to-br from-[#006c49] to-[#10b981] text-white px-5 py-3.5 rounded-2xl shadow-xl shadow-emerald-500/30 flex items-center gap-2 font-bold z-40 active:scale-95 transition-transform"
        >
          ➕ নতুন রিমাইন্ডার
        </button>
      )}

      {/* Add Medicine Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAddForm(false)} />
          <div className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 space-y-5 animate-in slide-in-from-bottom duration-300">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold" style={{ fontFamily: 'Manrope, sans-serif' }}>
                💊 রিমাইন্ডার সেটআপ
              </h3>
              <button
                onClick={() => setShowAddForm(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4">
              <div className="relative" ref={dropdownRef}>
                <label className="text-sm font-medium text-[#3c4a42] mb-1 block">ওষুধের নাম *</label>
                <div className="relative">
                  <input
                    type="text"
                    value={formData.name}
                    onChange={handleMedicineNameChange}
                    onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
                    placeholder="যেমন: নাপা ৫০০ মিলিগ্রাম"
                    className="w-full px-4 py-3 rounded-xl border border-[#bbcabf] bg-[#f7f9fb] text-[#191c1e] focus:outline-none focus:ring-2 focus:ring-[#10b981] transition-all"
                    autoComplete="off"
                  />
                  {searchLoading && (
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-[#10b981] border-t-transparent rounded-full animate-spin" />
                  )}
                </div>
                
                {showDropdown && searchResults.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-[#bbcabf] rounded-xl shadow-xl max-h-60 overflow-auto">
                    {searchResults.map((drug) => (
                      <button
                        key={drug.id}
                        type="button"
                        onClick={() => handleSelectMedicine(drug)}
                        className="w-full text-left px-4 py-3 hover:bg-[#f7f9fb] border-b border-gray-100 last:border-0 flex flex-col gap-0.5 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#191c1e]">{drug.brand_name}</span>
                          {drug.strength && <span className="text-sm text-[#6c7a71]">{drug.strength}</span>}
                        </div>
                        <div className="text-xs text-[#6c7a71]">
                          {drug.generic_name && <span className="text-[#006c49] truncate inline-block max-w-[200px] align-bottom">{drug.generic_name}</span>}
                          {drug.company_name && <span> • {drug.company_name}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-[#3c4a42] mb-1 block">প্রতি বার কতটুকু খাবেন</label>
                <select
                  value={formData.doseAmount}
                  onChange={(e) => setFormData((p) => ({ ...p, doseAmount: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-[#bbcabf] bg-[#f7f9fb] text-[#191c1e] focus:outline-none focus:ring-2 focus:ring-[#10b981] transition-all"
                >
                  <option value="">পরিমাণ নির্বাচন করুন</option>
                  <option value="০.৫ (অর্ধেক) পিস">০.৫ (অর্ধেক) পিস</option>
                  <option value="১ পিস">১ পিস</option>
                  <option value="১.৫ (দেড়) পিস">১.৫ (দেড়) পিস</option>
                  <option value="২ পিস">২ পিস</option>
                  <option value="৩ পিস">৩ পিস</option>
                  <option value="০.৫ (অর্ধেক) চামচ">০.৫ (অর্ধেক) চামচ</option>
                  <option value="১ চামচ">১ চামচ</option>
                  <option value="২ চামচ">২ চামচ</option>
                  <option value="৩ চামচ">৩ চামচ</option>
                  <option value="১ ড্রপ">১ ড্রপ</option>
                  <option value="২ ড্রপ">২ ড্রপ</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium text-[#3c4a42] mb-1 block">সময় *</label>
                  <input
                    type="time"
                    value={formData.timeSlot}
                    onChange={(e) => setFormData((p) => ({ ...p, timeSlot: e.target.value }))}
                    className="w-full px-4 py-3 rounded-xl border border-[#bbcabf] bg-[#f7f9fb] text-[#191c1e] focus:outline-none focus:ring-2 focus:ring-[#10b981] transition-all"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-[#3c4a42] mb-1 block">সময় (বাংলা, অপশনাল)</label>
                  <input
                    type="text"
                    value={formData.timeBn}
                    onChange={(e) => setFormData((p) => ({ ...p, timeBn: e.target.value }))}
                    placeholder="খালি রাখলে অটো হবে"
                    className="w-full px-4 py-3 rounded-xl border border-[#bbcabf] bg-[#f7f9fb] text-[#191c1e] focus:outline-none focus:ring-2 focus:ring-[#10b981] transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-[#3c4a42] mb-1 block">নির্দেশনা</label>
                <select
                  value={formData.instruction}
                  onChange={(e) => setFormData((p) => ({ ...p, instruction: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl border border-[#bbcabf] bg-[#f7f9fb] text-[#191c1e] focus:outline-none focus:ring-2 focus:ring-[#10b981] transition-all"
                >
                  {INSTRUCTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              onClick={handleAddMedicine}
                  disabled={!formData.name || !formData.timeSlot || submitting}
                  className="w-full py-3.5 bg-gradient-to-r from-[#006c49] to-[#10b981] text-white font-bold rounded-xl shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all flex items-center justify-center gap-2"
                >
                  {submitting ? (
                <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> সেভ হচ্ছে...</>
              ) : 'রিমাইন্ডার সেভ করুন'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

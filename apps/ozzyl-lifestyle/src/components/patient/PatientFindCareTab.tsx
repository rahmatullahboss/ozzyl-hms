import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, MapPin, Star, Stethoscope, Building2, Clock, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';

const API = import.meta.env.VITE_API_URL || '';

interface MarketplaceHospital {
  id: string;
  name: string;
  tenant_type: string;
  address: string | null;
  specialties: string | null;
  avg_rating: number;
  review_count: number;
}

interface MarketplaceDoctor {
  id: number;
  name: string;
  specialty: string;
  hospital_name: string;
  tenant_type: string;
  consultation_fee: number;
  avg_rating: number;
  review_count: number;
  languages: string | null;
}

export default function PatientFindCareTab() {
  const { t } = useTranslation('patients');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeView, setActiveView] = useState<'doctors' | 'hospitals'>('doctors');
  const [doctors, setDoctors] = useState<MarketplaceDoctor[]>([]);
  const [hospitals, setHospitals] = useState<MarketplaceHospital[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [specialty, setSpecialty] = useState('');
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const [bookingDoctor, setBookingDoctor] = useState<MarketplaceDoctor | null>(null);
  const [bookDate, setBookDate] = useState('');
  const [bookTime, setBookTime] = useState('');
  const [availability, setAvailability] = useState<{ time: string; available: boolean }[]>([]);
  const [bookingInProgress, setBookingInProgress] = useState(false);

  const SPECIALTIES = [
    'cardiology', 'dermatology', 'ent', 'gastroenterology', 'general medicine',
    'general surgery', 'gynecology', 'neurology', 'oncology', 'ophthalmology',
    'orthopedics', 'pediatrics', 'psychiatry', 'pulmonology', 'urology',
  ];

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '10' });
      if (searchQuery) params.set('q', searchQuery);
      if (specialty) params.set('specialty', specialty);

      const endpoint = activeView === 'doctors' ? 'doctors' : 'hospitals';
      const res = await fetch(`${API}/api/v1/marketplace/${endpoint}?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (activeView === 'doctors') {
          setDoctors(data.doctors || []);
        } else {
          setHospitals(data.hospitals || []);
        }
        setTotal(data.total || 0);
      }
    } catch {
      toast.error(t('findCare.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [searchQuery, activeView, page, specialty, t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch availability when booking date changes
  useEffect(() => {
    if (!bookingDoctor || !bookDate) return;
    const fetchSlots = async () => {
      try {
        const res = await fetch(`${API}/api/v1/marketplace/doctors/${bookingDoctor.id}/availability?date=${bookDate}`);
        if (res.ok) {
          const data = await res.json();
          setAvailability(data.slots || []);
        }
      } catch {
        setAvailability([]);
      }
    };
    fetchSlots();
  }, [bookingDoctor, bookDate]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchData();
  };

  const handleConnect = async (tenantId: string) => {
    setConnectingTo(tenantId);
    try {
      const res = await fetch(`${API}/api/v1/marketplace-patient/connect/${tenantId}`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.already_connected ? t('findCare.alreadyConnected') : t('findCare.connected'));
      } else {
        toast.error(data.error || t('findCare.connectFailed'));
      }
    } catch {
      toast.error(t('findCare.connectFailed'));
    } finally {
      setConnectingTo(null);
    }
  };

  const handleBook = async () => {
    if (!bookingDoctor || !bookDate || !bookTime) return;
    setBookingInProgress(true);
    try {
      const res = await fetch(`${API}/api/v1/marketplace-patient/bookings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctor_id: bookingDoctor.id,
          tenant_id: '', // Will be resolved by backend from doctor
          booking_date: bookDate,
          booking_time: bookTime,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(t('findCare.bookingSuccess'));
        setBookingDoctor(null);
        setBookDate('');
        setBookTime('');
      } else {
        toast.error(data.error || t('findCare.bookingFailed'));
      }
    } catch {
      toast.error(t('findCare.bookingFailed'));
    } finally {
      setBookingInProgress(false);
    }
  };

  const feeDisplay = (fee: number) => fee ? `৳${(fee / 100).toLocaleString()}` : 'N/A';
  const totalPages = Math.ceil(total / 10);

  return (
    <div className="space-y-6 animate-fade-in-up animate-in fade-in duration-500">
      {/* Header */}
      <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-[0_12px_40px_rgba(8,145,178,0.06)] border border-slate-100">
        <div className="relative overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-emerald-600 to-teal-600 p-6 sm:p-8 text-white">
          <div className="absolute -right-12 -top-12 w-48 h-48 bg-white/10 rounded-full blur-2xl" />
          <div className="absolute -left-12 -bottom-12 w-48 h-48 bg-white/10 rounded-full blur-2xl" />
          <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-200">{t('findCare.sectionTitle')}</p>
            <h2 className="mt-2 text-2xl sm:text-3xl font-bold">{t('findCare.headline')}</h2>
            <p className="mt-2 text-sm text-emerald-100 max-w-xl">{t('findCare.description')}</p>

            <form onSubmit={handleSearch} className="mt-5 flex gap-2 max-w-lg">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-300" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('findCare.searchPlaceholder')}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
              </div>
              <button type="submit" className="px-5 py-2.5 bg-white/20 hover:bg-white/30 rounded-xl text-sm font-semibold transition-colors">
                {t('findCare.searchButton')}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* View toggle + filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-slate-200 overflow-hidden">
          <button
            onClick={() => { setActiveView('doctors'); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeView === 'doctors' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            <Stethoscope className="w-4 h-4 inline mr-1.5" />
            {t('findCare.doctorsTab')}
          </button>
          <button
            onClick={() => { setActiveView('hospitals'); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeView === 'hospitals' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            <Building2 className="w-4 h-4 inline mr-1.5" />
            {t('findCare.hospitalsTab')}
          </button>
        </div>

        <select
          value={specialty}
          onChange={(e) => { setSpecialty(e.target.value); setPage(1); }}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
        >
          <option value="">{t('findCare.allSpecialties')}</option>
          {SPECIALTIES.map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>

        <span className="text-sm text-slate-400 ml-auto">
          {loading ? t('findCare.searching') : `${total} ${t('findCare.resultsFound')}`}
        </span>
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : activeView === 'doctors' ? (
        <div className="space-y-3">
          {doctors.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
              <Stethoscope className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <p className="font-medium text-slate-500">{t('findCare.noDoctorsFound')}</p>
              <p className="text-sm text-slate-400 mt-1">{t('findCare.adjustSearch')}</p>
            </div>
          ) : doctors.map((doc) => (
            <div key={doc.id} className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5 hover:shadow-md hover:border-emerald-200 transition-all">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center text-xl shrink-0">
                  👨‍⚕️
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-900 truncate">{doc.name}</h3>
                  <p className="text-sm text-emerald-600 capitalize">{doc.specialty}</p>
                  <p className="text-xs text-slate-400">
                    {doc.tenant_type === 'chamber' ? t('findCare.independentChamber') : doc.hospital_name}
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                    <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                    <span className="text-xs text-slate-600">{doc.avg_rating > 0 ? doc.avg_rating.toFixed(1) : '—'}</span>
                    <span className="text-xs text-slate-400">({doc.review_count})</span>
                  </div>
                </div>
                <div className="text-right shrink-0 space-y-2">
                  <p className="text-sm font-semibold text-green-700">{feeDisplay(doc.consultation_fee)}</p>
                  <button
                    onClick={() => { setBookingDoctor(doc); setBookDate(''); setBookTime(''); setAvailability([]); }}
                    className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 transition-colors font-medium"
                  >
                    {t('findCare.bookNow')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {hospitals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-12 text-center">
              <Building2 className="w-12 h-12 text-slate-200 mx-auto mb-3" />
              <p className="font-medium text-slate-500">{t('findCare.noHospitalsFound')}</p>
              <p className="text-sm text-slate-400 mt-1">{t('findCare.adjustSearch')}</p>
            </div>
          ) : hospitals.map((hosp) => {
            const specs: string[] = hosp.specialties ? JSON.parse(hosp.specialties) : [];
            return (
              <div key={hosp.id} className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5 hover:shadow-md hover:border-emerald-200 transition-all">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-2xl shrink-0">
                    {hosp.tenant_type === 'chamber' ? '🩺' : '🏥'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 truncate">{hosp.name}</h3>
                    {hosp.address && <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3" />{hosp.address}</p>}
                    <div className="flex items-center gap-1 mt-1">
                      <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                      <span className="text-xs text-slate-600">{hosp.avg_rating > 0 ? hosp.avg_rating.toFixed(1) : '—'}</span>
                      <span className="text-xs text-slate-400">({hosp.review_count})</span>
                    </div>
                    {specs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {specs.slice(0, 4).map((s) => (
                          <span key={s} className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full capitalize">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleConnect(hosp.id)}
                    disabled={connectingTo === hosp.id}
                    className="shrink-0 px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors font-medium"
                  >
                    {connectingTo === hosp.id ? t('findCare.connecting') : t('findCare.connect')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
          >
            ←
          </button>
          <span className="px-3 py-1.5 text-sm text-slate-500">{page} / {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
          >
            →
          </button>
        </div>
      )}

      {/* Booking Modal */}
      {bookingDoctor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-slate-900">{t('findCare.bookAppointment')}</h3>
              <button onClick={() => setBookingDoctor(null)} className="p-1 hover:bg-slate-100 rounded-lg">✕</button>
            </div>

            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
              <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center">👨‍⚕️</div>
              <div>
                <p className="font-medium text-slate-900">{bookingDoctor.name}</p>
                <p className="text-sm text-emerald-600 capitalize">{bookingDoctor.specialty}</p>
                <p className="text-xs text-green-600 font-medium">{feeDisplay(bookingDoctor.consultation_fee)}</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">{t('findCare.selectDate')}</label>
              <input
                type="date"
                value={bookDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => { setBookDate(e.target.value); setBookTime(''); }}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            {bookDate && availability.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">{t('findCare.availableSlots')}</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {availability.map((slot) => (
                    <button
                      key={slot.time}
                      onClick={() => setBookTime(slot.time)}
                      disabled={!slot.available}
                      className={`text-xs py-1.5 rounded-lg border transition-colors ${
                        bookTime === slot.time
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : slot.available
                          ? 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50'
                          : 'border-slate-100 text-slate-300 cursor-not-allowed'
                      }`}
                    >
                      {slot.time}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {bookDate && availability.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-2">{t('findCare.noSlots')}</p>
            )}

            <button
              onClick={handleBook}
              disabled={!bookDate || !bookTime || bookingInProgress}
              className="w-full py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition-colors"
            >
              {bookingInProgress ? t('findCare.bookingInProgress') : t('findCare.confirmBooking')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

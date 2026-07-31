import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import HospitalCard from '../components/marketplace/HospitalCard';
import DoctorCard from '../components/marketplace/DoctorCard';

const API = import.meta.env.VITE_API_URL || '';

export default function MarketplaceLanding() {
  const { t } = useTranslation(['landing', 'common']);
  
  const QUICK_SPECIALTIES = [
    { label: t('landing:specialties.cardiology'), key: 'cardiology', icon: '❤️' },
    { label: t('landing:specialties.dermatology'), key: 'dermatology', icon: '🧴' },
    { label: t('landing:specialties.pediatrics'), key: 'pediatrics', icon: '👶' },
    { label: t('landing:specialties.orthopedics'), key: 'orthopedics', icon: '🦴' },
    { label: t('landing:specialties.neurology'), key: 'neurology', icon: '🧠' },
    { label: t('landing:specialties.gynecology'), key: 'gynecology', icon: '🩺' },
    { label: t('landing:specialties.ent'), key: 'ent', icon: '👂' },
    { label: t('landing:specialties.ophthalmology'), key: 'ophthalmology', icon: '👁️' },
  ];

  const [searchQuery, setSearchQuery] = useState('');
  const [topHospitals, setTopHospitals] = useState<any[]>([]);
  const [topDoctors, setTopDoctors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchFeatured = async () => {
      try {
        const [hospRes, docRes] = await Promise.all([
          fetch(`${API}/api/v1/marketplace/hospitals?limit=4`),
          fetch(`${API}/api/v1/marketplace/doctors?limit=4`),
        ]);
        if (hospRes.ok) {
          const data = await hospRes.json();
          setTopHospitals(data.hospitals || []);
        }
        if (docRes.ok) {
          const data = await docRes.json();
          setTopDoctors(data.doctors || []);
        }
      } catch {
        // Silently fail — landing page is best-effort
      } finally {
        setLoading(false);
      }
    };
    fetchFeatured();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/marketplace/doctors?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 text-white px-4 py-16">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-3">{t('landing:heroTitle')}</h1>
          <p className="text-blue-100 mb-8 text-lg">{t('landing:heroSubtitle')}</p>

          <form onSubmit={handleSearch} className="flex max-w-xl mx-auto shadow-lg rounded-xl overflow-hidden">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('landing:searchPlaceholder')}
              className="flex-1 px-4 py-3 text-gray-900 focus:outline-none"
            />
            <button
              type="submit"
              className="px-6 py-3 bg-green-500 hover:bg-green-600 font-semibold transition-colors"
            >
              {t('common:search')}
            </button>
          </form>

          <div className="flex justify-center gap-4 mt-6 text-sm text-blue-200">
            <Link to="/marketplace/hospitals" className="hover:text-white">{t('landing:browseHospitals')}</Link>
            <span>·</span>
            <Link to="/marketplace/doctors" className="hover:text-white">{t('landing:findDoctors')}</Link>
            <span>·</span>
            <Link to="/doctor/register" className="hover:text-white">{t('landing:registerChamber')}</Link>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-10 space-y-12">
        {/* Quick Specialties */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('landing:browseBySpecialty')}</h2>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
            {QUICK_SPECIALTIES.map((s) => (
              <Link
                key={s.key}
                to={`/marketplace/doctors?specialty=${s.key}`}
                className="flex flex-col items-center gap-1 p-3 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow transition-all text-center"
              >
                <span className="text-2xl">{s.icon}</span>
                <span className="text-xs text-gray-700">{s.label}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* Top Hospitals */}
        {!loading && topHospitals.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{t('landing:topHospitals')}</h2>
              <Link to="/marketplace/hospitals" className="text-sm text-blue-600 hover:underline">{t('landing:viewAll')} →</Link>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {topHospitals.map((h: any) => (
                <HospitalCard key={h.id} hospital={h} />
              ))}
            </div>
          </section>
        )}

        {/* Top Doctors */}
        {!loading && topDoctors.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{t('landing:topDoctors')}</h2>
              <Link to="/marketplace/doctors" className="text-sm text-blue-600 hover:underline">{t('landing:viewAll')} →</Link>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {topDoctors.map((d: any) => (
                <DoctorCard key={d.id} doctor={d} />
              ))}
            </div>
          </section>
        )}

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* CTA for Doctors */}
        <section className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-8 text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-2">{t('landing:doctorCta.title')}</h2>
          <p className="text-sm text-gray-600 mb-5">{t('landing:doctorCta.subtitle')}</p>
          <div className="flex justify-center gap-3">
            <Link
              to="/doctor/register"
              className="inline-block bg-green-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-green-700 transition-colors"
            >
              {t('landing:doctorCta.register')}
            </Link>
            <Link
              to="/doctor/login"
              className="inline-block bg-white text-green-700 border border-green-300 px-6 py-2.5 rounded-lg font-semibold hover:bg-green-50 transition-colors"
            >
              {t('landing:doctorCta.login')}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

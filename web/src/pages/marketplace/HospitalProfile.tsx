import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import StarRating from '../../components/marketplace/StarRating';

import DoctorCard from '../../components/marketplace/DoctorCard';

const API = import.meta.env.VITE_API_URL || '';

export default function HospitalProfile() {
  const { t } = useTranslation(['marketing', 'common']);
  const { id } = useParams<{ id: string }>();

  const navigate = useNavigate();
  const [hospital, setHospital] = useState<any>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectMsg, setConnectMsg] = useState('');

  useEffect(() => {
    const fetchHospital = async () => {
      try {
        const [hospRes, revRes] = await Promise.all([
          fetch(`${API}/api/v1/marketplace/hospitals/${id}`),
          fetch(`${API}/api/v1/marketplace/hospitals/${id}/reviews`),
        ]);
        if (hospRes.ok) {
          const data = await hospRes.json();
          setHospital(data.hospital);
        } else {
          navigate('/marketplace/hospitals', { replace: true });
        }
        if (revRes.ok) {
          const data = await revRes.json();
          setReviews(data.reviews || []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    if (id) fetchHospital();
  }, [id, navigate]);

  const handleConnect = async () => {
    const token = localStorage.getItem('patient_token');
    if (!token) {
      navigate('/patient/login');
      return;
    }
    setConnectLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/marketplace-patient/connect/${id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setConnectMsg(res.ok 
        ? (data.already_connected ? t('marketing:profile.alreadyConnected') : t('marketing:profile.connected')) 
        : (data.error || t('marketing:profile.connectionFailed')));
    } catch {
      setConnectMsg(t('marketing:profile.connectionFailed'));
    } finally {
      setConnectLoading(false);
    }

  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  if (!hospital) return null;

  const specialties: string[] = hospital.specialties ? JSON.parse(hospital.specialties) : [];
  const photos: string[] = hospital.public_photos ? JSON.parse(hospital.public_photos) : [];
  const operatingHours: Record<string, string> = hospital.operating_hours ? JSON.parse(hospital.operating_hours) : {};
  const doctors: any[] = hospital.doctors || [];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Breadcrumb */}
      <div className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-2 text-sm text-gray-500">
          <Link to="/marketplace" className="hover:text-blue-600">{t('marketing:directory.hospitals.marketplace') || 'Marketplace'}</Link>
          <span>/</span>
          <Link to="/marketplace/hospitals" className="hover:text-blue-600">{t('marketing:directory.hospitals.title')}</Link>
          <span>/</span>
          <span className="text-gray-900 font-medium truncate">{hospital.name}</span>
        </div>
      </div>


      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Header card */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 bg-blue-50 rounded-xl flex items-center justify-center text-3xl shrink-0">
              {hospital.tenant_type === 'chamber' ? '🩺' : '🏥'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{hospital.name}</h1>
                  <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded capitalize">
                    {hospital.tenant_type}
                  </span>
                </div>
                <button
                  onClick={handleConnect}
                  disabled={connectLoading}
                  className="shrink-0 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {connectLoading ? t('marketing:profile.connecting') : t('marketing:profile.connect')}
                </button>
              </div>
              {connectMsg && <p className={`text-sm mt-1 ${connectMsg.includes('Failed') || connectMsg.includes('ব্যর্থ') ? 'text-red-600' : 'text-green-600'}`}>{connectMsg}</p>}

              {hospital.address && <p className="text-sm text-gray-500 mt-1">📍 {hospital.address}</p>}
              <div className="mt-2">
                <StarRating rating={hospital.avg_rating || 0} reviewCount={hospital.review_count || 0} size="md" />
              </div>
            </div>
          </div>

          {specialties.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-4">
              {specialties.map((s) => (
                <span key={s} className="text-sm px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full">
                  {t(`marketing:landing.specialties.${s}`)}
                </span>
              ))}
            </div>
          )}


          {hospital.public_description && (
            <p className="mt-4 text-sm text-gray-600 leading-relaxed">{hospital.public_description}</p>
          )}
        </div>

        {/* Operating Hours */}
        {Object.keys(operatingHours).length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="font-semibold text-gray-900 mb-3">{t('marketing:profile.operatingHours')}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(operatingHours).map(([day, hours]) => (
                <div key={day} className="text-sm">
                  <span className="font-medium text-gray-700">{t(`common:days.${day.toLowerCase().slice(0, 3)}`)}: </span>
                  <span className={hours === 'closed' ? 'text-red-400' : 'text-gray-600'}>
                    {hours === 'closed' ? t('common:closed') : hours}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}


        {/* Doctors at this hospital */}
        {doctors.length > 0 && (
          <div>
            <h2 className="font-semibold text-gray-900 mb-3">{t('marketing:directory.doctors.title')}</h2>
            <div className="grid md:grid-cols-2 gap-3">
              {doctors.map((d: any) => <DoctorCard key={d.id} doctor={d} />)}
            </div>
          </div>
        )}


        {/* Reviews */}
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">
            {t('marketing:cards.reviews', { count: reviews.length })}
          </h2>
          {reviews.length === 0 ? (
            <p className="text-sm text-gray-400 bg-white rounded-xl border border-gray-200 p-6 text-center">
              {t('marketing:cards.noReviews')}
            </p>
          ) : (
            <div className="space-y-3">
              {reviews.map((r: any) => (
                <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <StarRating rating={r.rating} size="sm" />
                    <span className="text-xs text-gray-400">{r.created_at?.slice(0, 10)}</span>
                  </div>
                  {r.review_text && <p className="text-sm text-gray-600">{r.review_text}</p>}
                  {r.is_verified_visit === 1 && (
                    <span className="text-xs text-green-600 mt-1 inline-block">
                      ✓ {t('marketing:cards.verifiedVisit')}
                    </span>
                  )}

                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

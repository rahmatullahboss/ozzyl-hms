import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MapPin, Star, Phone, Mail, Clock, Stethoscope, Building2, Link2 } from 'lucide-react';
import toast from 'react-hot-toast';

const API = import.meta.env.VITE_API_URL || '';

interface HospitalDetail {
  id: string;
  name: string;
  tenant_type: string;
  public_description?: string;
  specialties?: string;
  address?: string;
  phone?: string;
  email?: string;
  operating_hours?: string;
  avg_rating: number;
  review_count: number;
}

interface HospitalDoctor {
  id: number;
  name: string;
  specialty: string;
  qualifications?: string;
  consultation_fee: number;
  public_bio?: string;
  avg_rating: number;
  review_count: number;
}

interface HospitalProfileViewProps {
  hospitalId: string;
  onBack: () => void;
  onConnect?: (tenantId: string) => void;
  onBookDoctor?: (doctor: HospitalDoctor) => void;
}

export default function HospitalProfileView({ hospitalId, onBack, onConnect, onBookDoctor }: HospitalProfileViewProps) {
  const { t, i18n } = useTranslation('patientPortal');
  const isBn = i18n.language === 'bn';

  const [hospital, setHospital] = useState<HospitalDetail | null>(null);
  const [doctors, setDoctors] = useState<HospitalDoctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API}/api/v1/marketplace/hospitals/${hospitalId}`);
        if (res.ok) {
          const data = await res.json() as { hospital: HospitalDetail; doctors: HospitalDoctor[] };
          setHospital(data.hospital);
          setDoctors(data.doctors || []);
        }
      } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [hospitalId]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const res = await fetch(`${API}/api/v1/marketplace-patient/connect/${hospitalId}`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json() as { already_connected?: boolean; error?: string };
      if (res.ok) {
        toast.success(data.already_connected ? (isBn ? 'ইতিমধ্যে সংযুক্ত' : 'Already connected') : (isBn ? 'সফলভাবে সংযুক্ত হয়েছে!' : 'Successfully connected!'));
        onConnect?.(hospitalId);
      } else {
        toast.error(data.error || (isBn ? 'সংযুক্ত করা যায়নি' : 'Connection failed'));
      }
    } catch {
      toast.error(isBn ? 'সংযুক্ত করা যায়নি' : 'Connection failed');
    }
    setConnecting(false);
  }, [hospitalId, isBn, onConnect]);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-48 bg-slate-200 rounded-2xl" />
        <div className="h-6 bg-slate-200 rounded w-2/3" />
        <div className="h-4 bg-slate-200 rounded w-1/2" />
      </div>
    );
  }

  if (!hospital) {
    return (
      <div className="text-center py-12">
        <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500">{isBn ? 'হাসপাতাল পাওয়া যায়নি' : 'Hospital not found'}</p>
        <button onClick={onBack} className="mt-3 text-sm text-emerald-600 font-semibold">{isBn ? 'ফিরে যান' : 'Go Back'}</button>
      </div>
    );
  }

  const specs: string[] = hospital.specialties ? (() => { try { return JSON.parse(hospital.specialties); } catch { return []; } })() : [];
  const hours: Record<string, string> = hospital.operating_hours ? (() => { try { return JSON.parse(hospital.operating_hours); } catch { return {}; } })() : {};

  return (
    <div className="space-y-5 animate-fade-in-up">
      {/* Back button */}
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="w-4 h-4" /> {isBn ? 'ফিরে যান' : 'Back'}
      </button>

      {/* Hospital header */}
      <div className="bg-gradient-to-br from-emerald-600 to-teal-600 rounded-2xl p-6 text-white relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-48 h-48 bg-white/10 rounded-full blur-2xl" />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{hospital.tenant_type === 'chamber' ? '🩺' : '🏥'}</span>
            <h1 className="text-xl font-bold">{hospital.name}</h1>
          </div>
          {hospital.address && (
            <p className="text-sm text-emerald-100 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> {hospital.address}
            </p>
          )}
          <div className="flex items-center gap-3 mt-3">
            <div className="flex items-center gap-1">
              <Star className="w-4 h-4 text-yellow-300 fill-yellow-300" />
              <span className="font-semibold">{hospital.avg_rating > 0 ? hospital.avg_rating.toFixed(1) : '—'}</span>
              <span className="text-xs text-emerald-200">({hospital.review_count} {isBn ? 'রিভিউ' : 'reviews'})</span>
            </div>
          </div>
        </div>
      </div>

      {/* Connect button */}
      <button
        onClick={handleConnect}
        disabled={connecting}
        className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
      >
        <Link2 className="w-4 h-4" />
        {connecting ? '...' : (isBn ? 'এই হাসপাতালে সংযুক্ত হন' : 'Connect to This Hospital')}
      </button>

      {/* Details */}
      <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
        {hospital.public_description && (
          <div>
            <h3 className="text-sm font-bold text-slate-700 mb-1">{isBn ? 'পরিচিতি' : 'About'}</h3>
            <p className="text-sm text-slate-600">{hospital.public_description}</p>
          </div>
        )}

        {/* Contact info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {hospital.phone && (
            <a href={`tel:${hospital.phone}`} className="flex items-center gap-2 text-sm text-slate-600 hover:text-emerald-600">
              <Phone className="w-4 h-4 text-slate-400" /> {hospital.phone}
            </a>
          )}
          {hospital.email && (
            <a href={`mailto:${hospital.email}`} className="flex items-center gap-2 text-sm text-slate-600 hover:text-emerald-600">
              <Mail className="w-4 h-4 text-slate-400" /> {hospital.email}
            </a>
          )}
        </div>

        {/* Operating hours */}
        {Object.keys(hours).length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1">
              <Clock className="w-4 h-4 text-slate-400" /> {isBn ? 'কর্মঘণ্টা' : 'Operating Hours'}
            </h3>
            <div className="grid grid-cols-2 gap-1 text-xs text-slate-600">
              {Object.entries(hours).map(([day, time]) => (
                <div key={day} className="flex justify-between">
                  <span className="capitalize font-medium">{day}</span>
                  <span>{time}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Specialties */}
        {specs.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-1">
              <Stethoscope className="w-4 h-4 text-slate-400" /> {isBn ? 'বিভাগসমূহ' : 'Specialties'}
            </h3>
            <div className="flex flex-wrap gap-2">
              {specs.map((s) => (
                <span key={s} className="text-xs px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full capitalize">{s}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Doctors */}
      {doctors.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-700">
            {isBn ? `ডাক্তার (${doctors.length})` : `Doctors (${doctors.length})`}
          </h3>
          {doctors.map((doc) => (
            <div key={doc.id} className="bg-white rounded-xl p-4 shadow-sm flex items-start gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-full flex items-center justify-center text-lg shrink-0">👨‍⚕️</div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 text-sm truncate">{doc.name}</p>
                <p className="text-xs text-emerald-600 capitalize">{doc.specialty}</p>
                {doc.qualifications && <p className="text-[10px] text-slate-400 mt-0.5">{doc.qualifications}</p>}
                <div className="flex items-center gap-1 mt-1">
                  <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                  <span className="text-[10px] text-slate-500">{doc.avg_rating > 0 ? doc.avg_rating.toFixed(1) : '—'}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-semibold text-green-700">{doc.consultation_fee ? `৳${(doc.consultation_fee / 100).toLocaleString()}` : ''}</p>
                <button
                  onClick={() => onBookDoctor?.(doc)}
                  className="mt-1 px-3 py-1 bg-emerald-600 text-white text-[10px] rounded-lg font-medium hover:bg-emerald-500"
                >
                  {isBn ? 'অ্যাপয়েন্টমেন্ট' : 'Book'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

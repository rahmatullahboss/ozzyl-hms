import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import StarRating from './StarRating';


interface Hospital {
  id: string;
  name: string;
  tenant_type: string;
  public_description: string | null;
  specialties: string | null;
  public_photos: string | null;
  avg_rating: number;
  review_count: number;
  address?: string | null;
}

export default function HospitalCard({ hospital }: { hospital: Hospital }) {
  const { t } = useTranslation(['marketing', 'common']);
  const specialties: string[] = hospital.specialties ? JSON.parse(hospital.specialties) : [];


  return (
    <Link
      to={`/marketplace/hospitals/${hospital.id}`}
      className="block bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all p-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-14 h-14 bg-blue-50 rounded-lg flex items-center justify-center text-2xl shrink-0">
          {hospital.tenant_type === 'chamber' ? '🩺' : '🏥'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 truncate">{hospital.name}</h3>
            <span className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 capitalize">
              {hospital.tenant_type === 'chamber' 
                ? t('marketing:filters.typeChamber') 
                : t('marketing:filters.typeHospital')}
            </span>
          </div>

          {hospital.address && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">📍 {hospital.address}</p>
          )}
          <div className="mt-1">
            <StarRating rating={hospital.avg_rating} reviewCount={hospital.review_count} size="sm" />
          </div>
          {specialties.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {specialties.slice(0, 3).map((s) => (
                <span key={s} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">
                  {t(`marketing:landing.specialties.${s}`)}
                </span>
              ))}

              {specialties.length > 3 && (
                <span className="text-xs text-gray-400">+{t('common:more_count', { count: specialties.length - 3 })}</span>
              )}

            </div>
          )}
        </div>
      </div>
      {hospital.public_description && (
        <p className="text-sm text-gray-500 mt-3 line-clamp-2">{hospital.public_description}</p>
      )}
    </Link>
  );
}

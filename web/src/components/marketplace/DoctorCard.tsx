import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import StarRating from './StarRating';


interface Doctor {
  id: number;
  name: string;
  specialty: string;
  hospital_name: string;
  tenant_type: string;
  consultation_fee: number;
  public_bio: string | null;
  profile_photo_key: string | null;
  avg_rating: number;
  review_count: number;
  languages?: string | null;
}

export default function DoctorCard({ doctor }: { doctor: Doctor }) {
  const { t } = useTranslation(['marketing', 'common']);
  const languages: string[] = doctor.languages ? JSON.parse(doctor.languages) : [];

  return (
    <Link
      to={`/marketplace/doctors/${doctor.id}`}
      className="block bg-white rounded-xl border border-gray-200 hover:border-green-300 hover:shadow-md transition-all p-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center text-xl shrink-0">
          👨‍⚕️
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{doctor.name}</h3>
          <p className="text-sm text-blue-600 capitalize">
            {t(`marketing:landing.specialties.${doctor.specialty}`)}
          </p>
          <p className="text-xs text-gray-400 truncate">
            {doctor.tenant_type === 'chamber' ? t('marketing:filters.typeChamber') : doctor.hospital_name}
          </p>
          <div className="mt-1">
            <StarRating rating={doctor.avg_rating} reviewCount={doctor.review_count} size="sm" />
          </div>
          {languages.length > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              {languages.map(l => t(`marketing:languages.${l}`)).join(', ')}
            </p>
          )}

        </div>
        <div className="text-right shrink-0">
          <span className="text-sm font-semibold text-green-700">
            {doctor.consultation_fee
              ? t('marketing:cards.fee', { amount: doctor.consultation_fee.toLocaleString() })
              : t('common:n_a')}
          </span>
          <p className="text-xs text-gray-400">{t('common:per_visit')}</p>
        </div>

      </div>
    </Link>
  );
}

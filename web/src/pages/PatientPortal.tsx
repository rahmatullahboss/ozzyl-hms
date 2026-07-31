import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';

export default function PatientPortal() {
  const { t: _t } = useTranslation(['tenantClinical']);
  const { slug } = useParams<{ slug: string }>();

  useEffect(() => {
    if (slug) {
      window.localStorage.setItem('hms_last_slug', slug);
    }
  }, [slug]);

  return <Navigate to="/patient/home" replace />;
}

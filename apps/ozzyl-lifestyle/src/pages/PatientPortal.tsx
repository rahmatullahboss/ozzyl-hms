import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router';
import { getPatientPortalTopLevelPath } from '../lib/patientPortalRouting';

export default function PatientPortal() {
  const { slug } = useParams<{ slug: string }>();

  useEffect(() => {
    if (slug) {
      window.localStorage.setItem('hms_last_slug', slug);
    }
  }, [slug]);

  return <Navigate to={getPatientPortalTopLevelPath('home')} replace />;
}

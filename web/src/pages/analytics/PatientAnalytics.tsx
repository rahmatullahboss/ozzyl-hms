import { Navigate, useLocation, useParams } from 'react-router';

/**
 * Compatibility route for the historical patient analytics URL.
 * Supported analytics now live in the Admin Command Center Patients workspace.
 */
export default function PatientAnalytics() {
  const { slug = '' } = useParams<{ slug: string }>();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set('tab', 'patients');
  return <Navigate replace to={`/h/${slug}/dashboard/v2?${params.toString()}`} />;
}

import { Navigate, useParams } from 'react-router';
import { buildTenantRedirectTarget } from '../lib/tenantRedirect';

export default function ApprovalCenter(_props: { role?: string } = {}) {
  const { slug = '' } = useParams<{ slug: string }>();
  return <Navigate to={buildTenantRedirectTarget(slug, 'action')} replace />;
}

import { useNavigate } from 'react-router';
import { Eye, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

/**
 * ImpersonationBanner — sticky bar shown when a super admin is viewing
 * a hospital's dashboard via the impersonation feature.
 *
 * SECURITY (P0-34): The previous version restored the super-admin token
 * from `hms_super_token` in localStorage. We no longer persist tokens
 * to localStorage, so the "Exit" button simply forwards to the super-
 * admin dashboard; the user will need to sign in again. The banner is
 * otherwise non-sensitive (it only displays the tenant name).
 */
export default function ImpersonationBanner() {
  const navigate = useNavigate();
  const { user } = useAuth();

  if (!user?.isImpersonation) {
    return null;
  }

  const handleExit = () => {
    // P0-34: no localStorage token restore. The super admin must log in again.
    navigate('/super-admin/dashboard');
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-3 px-4 py-2"
      style={{
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        color: 'white',
        fontSize: '13px',
        fontWeight: 500,
      }}
    >
      <Eye className="w-4 h-4 flex-shrink-0" />
      <span className="font-semibold">Impersonation Active</span>
      <span>
        Viewing as: <strong>{user.role}</strong>
        {user.supportReason ? <span className="ml-1 opacity-90">({user.supportReason})</span> : null}
      </span>
      <button
        onClick={handleExit}
        className="ml-2 flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold
                   bg-white/20 hover:bg-white/30 transition-colors backdrop-blur-sm"
      >
        <X className="w-3 h-3" /> Exit Impersonation
      </button>
    </div>
  );
}

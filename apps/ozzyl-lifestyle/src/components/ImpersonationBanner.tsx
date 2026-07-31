import { useNavigate } from 'react-router';
import { Eye, X } from 'lucide-react';
import { saveToken } from '../hooks/useAuth';

/**
 * ImpersonationBanner — sticky bar shown when a super admin is viewing
 * a hospital's dashboard via the impersonation feature.
 *
 * Detects impersonation from localStorage `hms_impersonating` flag
 * (set by SuperAdminHospitalList / SuperAdminHospitalDetail).
 *
 * "Exit" restores the original super admin token from `hms_super_token`.
 */
export default function ImpersonationBanner() {
  const navigate = useNavigate();
  const raw = localStorage.getItem('hms_impersonating');

  if (!raw) return null;

  let info: { tenantName: string; tenantId: number };
  try {
    info = JSON.parse(raw);
  } catch {
    return null;
  }

  const handleExit = () => {
    // Restore super admin token
    const superToken = localStorage.getItem('hms_super_token');
    if (superToken) {
      saveToken(superToken);
      localStorage.removeItem('hms_super_token');
    }
    localStorage.removeItem('hms_impersonating');
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
      <span>
        Viewing as: <strong>{info.tenantName}</strong>
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

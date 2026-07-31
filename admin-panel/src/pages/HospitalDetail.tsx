import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import {
  Building2,
  Users,
  ArrowLeft,
  HeartPulse,
  DollarSign,
  Eye,
  Brain,
  ToggleLeft,
  ToggleRight,
  Loader2,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { buildTenantUrl } from '../lib/tenant-url';

export function storeTenantImpersonationSession({
  token,
  tenantName,
  tenantId,
}: {
  token: string;
  tenantName: string;
  tenantId: number;
}) {
  const currentToken = localStorage.getItem('hms_token');
  if (currentToken) {
    localStorage.setItem('hms_super_token', currentToken);
  }
  localStorage.setItem('hms_token', token);
  localStorage.setItem(
    'hms_impersonating',
    JSON.stringify({ tenantName, tenantId }),
  );
}

export default function HospitalDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hospitalId = Number(id);
  const { toast } = useToast();

  const [addons, setAddons] = useState<string[]>([]);
  const [showImpersonateConfirm, setShowImpersonateConfirm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['hospital', hospitalId],
    queryFn: () => api.hospitals.get(hospitalId),
    enabled: !isNaN(hospitalId),
  });

  useEffect(() => {
    if (data?.hospital?.addons) {
      try {
        const parsed = JSON.parse(data.hospital.addons);
        if (Array.isArray(parsed)) setAddons(parsed);
      } catch {
        setAddons([]);
      }
    } else {
      setAddons([]);
    }
  }, [data?.hospital?.addons]);

  const impersonateMutation = useMutation({
    mutationFn: () => api.impersonate.start(hospitalId),
    onSuccess: (res) => {
      storeTenantImpersonationSession({
        token: res.token,
        tenantName: (res.tenant as any)?.name || data?.hospital?.name || 'Hospital',
        tenantId: hospitalId,
      });
      toast('success', 'Impersonation started. Opening dashboard in new tab.');
      window.open(res.redirectUrl, '_blank');
      setShowImpersonateConfirm(false);
    },
    onError: (err: Error) => {
      toast('error', err.message || 'Failed to impersonate');
    },
  });

  const toggleFeatureMutation = useMutation({
    mutationFn: ({ feature, enabled }: { feature: string; enabled: boolean }) => {
      let newAddons = [...addons];
      if (enabled && !newAddons.includes(feature)) {
        newAddons.push(feature);
      } else if (!enabled) {
        newAddons = newAddons.filter((f) => f !== feature);
      }
      return api.hospitals.updateAddons(hospitalId, newAddons);
    },
    onSuccess: (_, vars) => {
      setAddons((prev) => {
        if (vars.enabled && !prev.includes(vars.feature)) {
          return [...prev, vars.feature];
        } else if (!vars.enabled) {
          return prev.filter((f) => f !== vars.feature);
        }
        return prev;
      });
      queryClient.invalidateQueries({ queryKey: ['hospital', hospitalId] });
      toast('success', vars.enabled ? 'Feature enabled' : 'Feature disabled');
    },
    onError: (err: Error) => {
      toast('error', err.message || 'Failed to update feature');
    },
  });

  const handleToggleFeature = (feature: string, enabled: boolean) => {
    toggleFeatureMutation.mutate({ feature, enabled });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!data?.hospital) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-slate-800">Hospital not found</h2>
        <button
          onClick={() => navigate('/hospitals')}
          className="mt-4 text-primary-600 hover:underline"
        >
          Go back
        </button>
      </div>
    );
  }

  const { hospital } = data;

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate('/hospitals')}
        className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-800 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Hospitals
      </button>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-xl bg-primary-100 flex items-center justify-center">
              <Building2 className="w-8 h-8 text-primary-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{hospital.name}</h1>
              <p className="text-slate-500 mt-1">{buildTenantUrl(hospital.subdomain)}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowImpersonateConfirm(true)}
              disabled={impersonateMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {impersonateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              {impersonateMutation.isPending ? 'Opening...' : 'Impersonate'}
            </button>
            <span
              className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                hospital.status === 'active'
                  ? 'bg-green-100 text-green-700'
                  : hospital.status === 'inactive'
                  ? 'bg-slate-100 text-slate-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {hospital.status}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-red-50 rounded-lg">
              <HeartPulse className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Total Patients</p>
              <p className="text-xl font-bold text-slate-900">{hospital.stats?.patients || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 rounded-lg">
              <DollarSign className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Total Billed</p>
              <p className="text-xl font-bold text-slate-900">
                ৳{hospital.stats?.totalBilled?.toLocaleString() || 0}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-green-50 rounded-lg">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Total Paid</p>
              <p className="text-xl font-bold text-slate-900">
                ৳{hospital.stats?.totalPaid?.toLocaleString() || 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Features & Settings</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Brain className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="font-medium text-slate-900">AI Patient Summary</p>
                <p className="text-sm text-slate-500">
                  Enable AI-powered clinical overviews for doctors
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={addons.includes('ai-summary')}
              aria-label="AI Patient Summary"
              onClick={() => handleToggleFeature('ai-summary', !addons.includes('ai-summary'))}
              disabled={toggleFeatureMutation.isPending}
              className="disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {addons.includes('ai-summary') ? (
                <ToggleRight className="w-10 h-6 text-primary-600" />
              ) : (
                <ToggleLeft className="w-10 h-6 text-slate-400" />
              )}
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div>
              <p className="font-medium text-slate-900">Plan</p>
              <p className="text-sm text-slate-500">Current subscription plan</p>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${
                hospital.plan === 'enterprise'
                  ? 'bg-purple-100 text-purple-700'
                  : hospital.plan === 'professional'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {hospital.plan}
            </span>
          </div>

          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
            <div>
              <p className="font-medium text-slate-900">Created</p>
              <p className="text-sm text-slate-500">Hospital registration date</p>
            </div>
            <span className="text-sm text-slate-600">
              {hospital.created_at
                ? new Date(hospital.created_at).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })
                : '-'}
            </span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200">
        <div className="p-5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-slate-600" />
            <h2 className="text-lg font-semibold text-slate-800">Users</h2>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {hospital.users?.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No users found
                  </td>
                </tr>
              ) : (
                hospital.users?.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{user.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 capitalize">
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={showImpersonateConfirm}
        title="Impersonate Hospital Admin"
        message={`You will be logged in as admin of "${hospital.name}". The dashboard will open in a new tab. Continue?`}
        confirmLabel="Impersonate"
        variant="warning"
        loading={impersonateMutation.isPending}
        onConfirm={() => impersonateMutation.mutate()}
        onCancel={() => setShowImpersonateConfirm(false)}
      />
    </div>
  );
}

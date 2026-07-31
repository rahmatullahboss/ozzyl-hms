import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { ClipboardList, CheckCircle, XCircle, Clock, Rocket, ChevronDown, Inbox } from 'lucide-react';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import ProvisionHospitalModal, { type ProvisionRequest } from '../components/ProvisionHospitalModal';
import EmptyState from '../components/EmptyState';

export default function Onboarding() {
  const [filter, setFilter] = useState<string>('');
  const [showProvisionModal, setShowProvisionModal] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ id: string; status: string } | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['onboarding', filter],
    queryFn: () => api.onboarding.list(filter || undefined),
  });

  const provisionRequest: ProvisionRequest | null = (() => {
    if (!showProvisionModal) return null;
    const r = data?.requests?.find((req) => req.id === showProvisionModal);
    if (!r) return null;
    return {
      id: r.id,
      hospitalName: r.hospital_name,
      contactName: r.contact_name,
      contactEmail: r.contact_email,
    };
  })();

  const updateMutation = useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: string; notes?: string }) =>
      api.onboarding.update(id, { status, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      toast('success', 'Onboarding request updated');
      setConfirmAction(null);
    },
    onError: (err: Error) => {
      toast('error', err.message || 'Failed to update request');
    },
  });

  const provisionMutation = useMutation({
    mutationFn: ({ id, slug, adminEmail, adminName, plan }: { id: string; slug: string; adminEmail: string; adminName: string; plan: string }) =>
      api.onboarding.provision(id, { slug, adminEmail, adminName, plan }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboarding'] });
      setShowProvisionModal(null);
      toast('success', 'Hospital provisioned successfully');
    },
    onError: (err: Error) => {
      toast('error', err.message || 'Failed to provision hospital');
    },
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'rejected': return <XCircle className="w-4 h-4 text-red-600" />;
      case 'provisioned': return <Rocket className="w-4 h-4 text-blue-600" />;
      default: return <Clock className="w-4 h-4 text-orange-600" />;
    }
  };

  const handleStatusChange = (id: string, status: string) => {
    setConfirmAction({ id, status });
  };

  const confirmStatusChange = () => {
    if (!confirmAction) return;
    updateMutation.mutate({ id: confirmAction.id, status: confirmAction.status });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-800">Onboarding Queue</h2>
        <div className="relative">
          <select
            value={filter}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value)}
            className="appearance-none pl-4 pr-10 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none bg-white"
          >
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="contacted">Contacted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="provisioned">Provisioned</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Hospital</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Contact</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Phone</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Submitted</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                  </td>
                </tr>
              ) : data?.requests?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <EmptyState
                      icon={Inbox}
                      title={filter ? 'No requests match this filter' : 'No onboarding requests'}
                      description={
                        filter
                          ? 'Try a different status filter.'
                          : 'New hospital signup requests will appear here for review.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                data?.requests?.map((request) => (
                  <tr key={request.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <ClipboardList className="w-5 h-5 text-slate-400" />
                        <span className="font-medium text-slate-900">{request.hospital_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-medium text-slate-900">{request.contact_name}</p>
                        <p className="text-xs text-slate-500">{request.contact_email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{request.contact_phone || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {getStatusIcon(request.status)}
                        <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${
                          request.status === 'approved' ? 'bg-green-100 text-green-700' :
                          request.status === 'rejected' ? 'bg-red-100 text-red-700' :
                          request.status === 'provisioned' ? 'bg-blue-100 text-blue-700' :
                          'bg-orange-100 text-orange-700'
                        }`}>
                          {request.status}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {new Date(request.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {request.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleStatusChange(request.id, 'approved')}
                              className="px-3 py-1.5 text-xs font-medium bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleStatusChange(request.id, 'rejected')}
                              className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 rounded-lg hover:bg-red-100 transition-colors"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {request.status === 'approved' && (
                          <button
                            onClick={() => setShowProvisionModal(request.id)}
                            className="px-3 py-1.5 text-xs font-medium bg-primary-50 text-primary-700 rounded-lg hover:bg-primary-100 transition-colors"
                          >
                            Provision
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.status === 'approved' ? 'Approve Request' : 'Reject Request'}
        message={
          confirmAction?.status === 'approved'
            ? 'This will approve the onboarding request. The hospital can then be provisioned. Continue?'
            : 'This will reject the onboarding request. This action can be undone later. Continue?'
        }
        confirmLabel={confirmAction?.status === 'approved' ? 'Approve' : 'Reject'}
        variant={confirmAction?.status === 'approved' ? 'default' : 'danger'}
        loading={updateMutation.isPending}
        onConfirm={confirmStatusChange}
        onCancel={() => setConfirmAction(null)}
      />

      <ProvisionHospitalModal
        request={provisionRequest}
        onClose={() => setShowProvisionModal(null)}
        onProvisioned={(res) => {
          queryClient.invalidateQueries({ queryKey: ['onboarding'] });
          queryClient.invalidateQueries({ queryKey: ['stats'] });
          setShowProvisionModal(null);
          toast(
            'success',
            `Provisioned ${res.hospital.name}. Temporary password: ${res.credentials.password}`,
          );
        }}
      />
    </div>
  );
}

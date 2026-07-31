import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { Building2, Search, Plus, Eye, Trash2, Power, Hospital } from 'lucide-react';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import Pagination from '../components/Pagination';
import CreateHospitalModal from '../components/CreateHospitalModal';
import useDebouncedValue from '../hooks/useDebouncedValue';
import useUrlState from '../hooks/useUrlState';
import EmptyState from '../components/EmptyState';

export default function Hospitals() {
  const [urlPage, setUrlPage, urlSearch, setUrlSearch] = useUrlState();
  const [rawSearch, setRawSearch] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(rawSearch, 300);
  // When the URL changes (deep link / browser back), sync the raw input.
  if (urlSearch !== debouncedSearch && urlSearch !== rawSearch) {
    setRawSearch(urlSearch);
  }
  const page = urlPage;
  const search = debouncedSearch;
  const setPage = (next: number) => {
    setUrlPage(next);
  };
  const setSearch = (next: string) => {
    setUrlSearch(next);
  };
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [statusToggle, setStatusToggle] = useState<{ id: number; next: string; name: string } | null>(null);
  const limit = 20;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['hospitals', page, search],
    queryFn: () => api.hospitals.list(page, limit, search || undefined),
    enabled: search === undefined || search.length === 0 || search === debouncedSearch,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { status?: string; plan?: string } }) =>
      api.hospitals.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hospitals'] });
      toast('success', 'Hospital updated');
    },
    onError: (err: Error) => {
      toast('error', err.message || 'Failed to update hospital');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.hospitals.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hospitals'] });
      toast('success', 'Hospital deactivated');
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast('error', err.message || 'Failed to delete hospital');
    },
  });

  const requestToggleStatus = (hospital: { id: number; status: string; name: string }) => {
    const next = hospital.status === 'active' ? 'inactive' : 'active';
    setStatusToggle({ id: hospital.id, next, name: hospital.name });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <label htmlFor="hospital-search" className="sr-only">Search hospitals</label>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="hospital-search"
            type="text"
            placeholder="Search hospitals…"
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Hospital
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Hospital</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Subdomain</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Plan</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Users</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Patients</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Created</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                  </td>
                </tr>
              ) : data?.hospitals?.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState
                      icon={Hospital}
                      title={search ? 'No hospitals match your search' : 'No hospitals yet'}
                      description={
                        search
                          ? `No results for "${search}". Try a different search term.`
                          : 'Add your first hospital to get the platform started.'
                      }
                      action={
                        !search ? (
                          <button
                            type="button"
                            onClick={() => setShowCreateModal(true)}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
                          >
                            <Plus className="w-4 h-4" />
                            Add Hospital
                          </button>
                        ) : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                data?.hospitals?.map((hospital) => (
                  <tr key={hospital.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                          <Building2 className="w-4 h-4 text-primary-600" />
                        </div>
                        <span className="font-medium text-slate-900">{hospital.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{hospital.subdomain}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 capitalize">
                        {hospital.plan}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        hospital.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : hospital.status === 'inactive'
                          ? 'bg-slate-100 text-slate-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {hospital.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">{hospital.user_count || 0}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{hospital.patient_count || 0}</td>
                    <td className="px-4 py-3 text-sm text-slate-500">
                      {new Date(hospital.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`/hospitals/${hospital.id}`}
                          className="p-1.5 text-slate-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                        <button
                          onClick={() => requestToggleStatus(hospital)}
                          disabled={updateMutation.isPending}
                          className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors disabled:opacity-50"
                          title={hospital.status === 'active' ? 'Deactivate' : 'Activate'}
                          aria-label={hospital.status === 'active' ? `Deactivate ${hospital.name}` : `Activate ${hospital.name}`}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        <button
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Delete"
                          aria-label={`Delete ${hospital.name}`}
                          onClick={() => setDeleteTarget(hospital.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {data?.pagination && (
          <Pagination
            page={page}
            totalPages={data.pagination.totalPages}
            total={data.pagination.total}
            limit={limit}
            onPageChange={setPage}
          />
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Deactivate Hospital"
        message="This will set the hospital status to inactive. Users won't be able to access it. Are you sure?"
        confirmLabel="Deactivate"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={statusToggle !== null}
        title={statusToggle?.next === 'inactive' ? 'Deactivate Hospital' : 'Activate Hospital'}
        message={
          statusToggle
            ? `Set "${statusToggle.name}" to ${statusToggle.next}? Users ${
                statusToggle.next === 'inactive' ? "won't be able to" : 'will be able to'
              } access the system.`
            : ''
        }
        confirmLabel={statusToggle?.next === 'inactive' ? 'Deactivate' : 'Activate'}
        variant={statusToggle?.next === 'inactive' ? 'warning' : 'default'}
        loading={updateMutation.isPending}
        onConfirm={() => {
          if (statusToggle) {
            updateMutation.mutate({ id: statusToggle.id, data: { status: statusToggle.next } });
          }
          setStatusToggle(null);
        }}
        onCancel={() => setStatusToggle(null)}
      />

      <CreateHospitalModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['hospitals'] });
        }}
      />
    </div>
  );
}

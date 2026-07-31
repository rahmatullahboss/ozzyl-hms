import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/apiClient';
import toast from 'react-hot-toast';
import {
  UserPlus, Globe, CheckCircle, Building2, Stethoscope,
  CalendarDays, AlertCircle, Loader2,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';

interface Doctor {
  id: number;
  name: string;
  specialty?: string;
  is_marketplace_visible?: number;
}

interface SetupStatus {
  doctors: { total: number; published: number };
  hospital: { isPublished: boolean; hasDescription: boolean; hasSpecialties: boolean; hasPhotos: boolean; hasLocation: boolean };
  schedules: { total: number };
  steps: { addDoctors: boolean; publishHospital: boolean; addSchedules: boolean; publishDoctors: boolean };
  isComplete: boolean;
}

export default function HospitalSetupWizard({ role = 'hospital_admin' }: { role?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDoctorModal, setShowDoctorModal] = useState(false);

  const [docForm, setDocForm] = useState({
    name: '', specialty: '', mobileNumber: '', consultationFee: '',
    publicBio: '', languages: '', bmdcRegNo: '', qualifications: '',
    publishToMarketplace: true,
  });

  const { data: statusData, isLoading: loadingStatus } = useQuery<SetupStatus>({
    queryKey: ['tenant', 'setup-status'],
    queryFn: () => api.get<SetupStatus>('/api/tenant/setup-status'),
  });
  const status = statusData;

  const { data: doctorsData } = useQuery<{ data: Doctor[] }>({
    queryKey: ['doctors', 'list'],
    queryFn: () => api.get<{ data: Doctor[] }>('/api/doctors'),
  });
  const doctors = doctorsData?.data ?? [];

  const createDoctorMutation = useMutation({
    mutationFn: (body: unknown) => api.post('/api/doctors', body),
    onSuccess: () => {
      toast.success('Doctor added successfully');
      setShowDoctorModal(false);
      setDocForm({ name: '', specialty: '', mobileNumber: '', consultationFee: '', publicBio: '', languages: '', bmdcRegNo: '', qualifications: '', publishToMarketplace: true });
      queryClient.invalidateQueries({ queryKey: ['tenant', 'setup-status'] });
      queryClient.invalidateQueries({ queryKey: ['doctors'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to add doctor'),
  });

  const publishHospitalMutation = useMutation({
    mutationFn: () => api.put('/api/v1/marketplace/publish', { is_published: true }),
    onSuccess: () => { toast.success('Hospital published to marketplace'); queryClient.invalidateQueries({ queryKey: ['tenant', 'setup-status'] }); },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  const publishDoctorMutation = useMutation({
    mutationFn: (id: number) => api.post(`/api/doctors/${id}/publish`, {}),
    onSuccess: () => { toast.success('Doctor published'); queryClient.invalidateQueries({ queryKey: ['tenant', 'setup-status'] }); queryClient.invalidateQueries({ queryKey: ['doctors'] }); },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  if (loadingStatus) {
    return (
      <DashboardLayout role={role}>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)]" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role={role}>
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="page-title">Welcome to HMS!</h1>
          <p className="section-subtitle">Complete these steps to get your hospital live on the marketplace</p>
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-[var(--color-text-muted)]">Setup Progress</span>
            <span className="text-sm font-bold text-[var(--color-primary)]">
              {status?.isComplete ? '100%' : `${Math.round(((status?.doctors.total ?? 0) > 0 ? 1 : 0) + (status?.hospital.isPublished ? 1 : 0) + (status?.steps.publishDoctors ? 1 : 0)) / 3 * 100}%`}
            </span>
          </div>
          <div className="w-full bg-[var(--color-border-light)] rounded-full h-2">
            <div
              className="h-2 rounded-full bg-[var(--color-primary)] transition-all"
              style={{ width: status?.isComplete ? '100%' : `${(((status?.doctors.total ?? 0) > 0 ? 1 : 0) + (status?.hospital.isPublished ? 1 : 0) + (status?.steps.publishDoctors ? 1 : 0)) / 3 * 100}%` }}
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className={`card p-5 border-l-4 ${status?.steps.addDoctors ? 'border-emerald-500' : 'border-[var(--color-primary)]'}`}>
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${status?.steps.addDoctors ? 'bg-emerald-50 text-emerald-600' : 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'}`}>
                {status?.steps.addDoctors ? <CheckCircle className="w-5 h-5" /> : <Stethoscope className="w-5 h-5" />}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">Add Your Doctors</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">Add doctor profiles with their specialties, fees, and marketplace details.</p>

                {doctors.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {doctors.map((d: Doctor) => (
                      <div key={d.id} className="flex items-center justify-between p-3 bg-[var(--color-bg)] rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[var(--color-primary-light)] flex items-center justify-center text-sm font-bold text-[var(--color-primary)]">
                            {d.name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{d.name}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">{d.specialty || 'No specialty'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {d.is_marketplace_visible ? (
                            <span className="badge badge-success text-xs">Published</span>
                          ) : (
                            <button onClick={() => publishDoctorMutation.mutate(d.id)} className="btn-ghost text-xs text-blue-600">Publish</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={() => setShowDoctorModal(true)} className="btn-primary text-sm mt-3 flex items-center gap-1">
                  <UserPlus className="w-4 h-4" /> Add Doctor
                </button>
              </div>
            </div>
          </div>

          <div className={`card p-5 border-l-4 ${status?.hospital.isPublished ? 'border-emerald-500' : status?.steps.addDoctors ? 'border-[var(--color-primary)]' : 'border-gray-200'}`}>
            <div className="flex items-start gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${status?.hospital.isPublished ? 'bg-emerald-50 text-emerald-600' : status?.steps.addDoctors ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]' : 'bg-gray-50 text-gray-400'}`}>
                {status?.hospital.isPublished ? <CheckCircle className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">Publish Hospital to Marketplace</h3>
                <p className="text-sm text-[var(--color-text-muted)] mt-1">Make your hospital discoverable to patients searching for care.</p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className={`p-2 rounded-lg text-xs flex items-center gap-2 ${status?.hospital.hasDescription ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {status?.hospital.hasDescription ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    Description
                  </div>
                  <div className={`p-2 rounded-lg text-xs flex items-center gap-2 ${status?.hospital.hasSpecialties ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {status?.hospital.hasSpecialties ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    Specialties
                  </div>
                  <div className={`p-2 rounded-lg text-xs flex items-center gap-2 ${status?.hospital.hasPhotos ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {status?.hospital.hasPhotos ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    Photos
                  </div>
                  <div className={`p-2 rounded-lg text-xs flex items-center gap-2 ${status?.hospital.hasLocation ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {status?.hospital.hasLocation ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                    Location
                  </div>
                </div>

                <button
                  onClick={() => publishHospitalMutation.mutate()}
                  disabled={!status?.steps.addDoctors || status?.hospital.isPublished}
                  className="btn-primary text-sm mt-3 flex items-center gap-1 disabled:opacity-50"
                >
                  <Globe className="w-4 h-4" />
                  {status?.hospital.isPublished ? 'Already Published' : 'Publish Hospital'}
                </button>
              </div>
            </div>
          </div>

          {status?.isComplete && (
            <div className="card p-5 border-l-4 border-emerald-500 bg-emerald-50/50">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-lg text-emerald-800">You're All Set!</h3>
                  <p className="text-sm text-emerald-600">Your hospital and doctors are now live on the marketplace.</p>
                  <button onClick={() => navigate('/dashboard')} className="btn-primary text-sm mt-3">
                    Go to Dashboard
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {showDoctorModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold">Add New Doctor</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="label">Name *</label><input className="input w-full" value={docForm.name} onChange={e => setDocForm(f => ({ ...f, name: e.target.value }))} placeholder="Dr. Name" /></div>
                <div><label className="label">Specialty</label><input className="input w-full" value={docForm.specialty} onChange={e => setDocForm(f => ({ ...f, specialty: e.target.value }))} placeholder="e.g. Cardiology" /></div>
                <div><label className="label">Consultation Fee *</label><input type="number" className="input w-full" value={docForm.consultationFee} onChange={e => setDocForm(f => ({ ...f, consultationFee: e.target.value }))} placeholder="0" /></div>
                <div><label className="label">Mobile</label><input className="input w-full" value={docForm.mobileNumber} onChange={e => setDocForm(f => ({ ...f, mobileNumber: e.target.value }))} placeholder="+8801..." /></div>
                <div><label className="label">BMDC Reg No</label><input className="input w-full" value={docForm.bmdcRegNo} onChange={e => setDocForm(f => ({ ...f, bmdcRegNo: e.target.value }))} placeholder="Registration number" /></div>
                <div className="col-span-2"><label className="label">Qualifications</label><input className="input w-full" value={docForm.qualifications} onChange={e => setDocForm(f => ({ ...f, qualifications: e.target.value }))} placeholder="MBBS, FCPS, etc." /></div>
                <div className="col-span-2"><label className="label">Languages (comma-separated)</label><input className="input w-full" value={docForm.languages} onChange={e => setDocForm(f => ({ ...f, languages: e.target.value }))} placeholder="Bangla, English" /></div>
                <div className="col-span-2"><label className="label">Public Bio</label><textarea rows={2} className="input w-full" value={docForm.publicBio} onChange={e => setDocForm(f => ({ ...f, publicBio: e.target.value }))} placeholder="Short bio for marketplace..." /></div>
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" checked={docForm.publishToMarketplace} onChange={e => setDocForm(f => ({ ...f, publishToMarketplace: e.target.checked }))} />
                  <label className="text-sm">Publish to marketplace immediately</label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowDoctorModal(false)} className="btn btn-secondary text-sm">Cancel</button>
                <button onClick={() => createDoctorMutation.mutate({
                  name: docForm.name,
                  specialty: docForm.specialty || undefined,
                  mobileNumber: docForm.mobileNumber || undefined,
                  consultationFee: Number(docForm.consultationFee) || 0,
                  publicBio: docForm.publicBio || undefined,
                  languages: docForm.languages ? docForm.languages.split(',').map(s => s.trim()) : undefined,
                  bmdcRegNo: docForm.bmdcRegNo || undefined,
                  qualifications: docForm.qualifications || undefined,
                  publishToMarketplace: docForm.publishToMarketplace,
                })} disabled={createDoctorMutation.isPending || !docForm.name} className="btn btn-primary text-sm">{createDoctorMutation.isPending ? 'Adding...' : 'Add Doctor'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

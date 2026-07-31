import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from './Toast';
import { X } from 'lucide-react';
import { api } from '../services/api';

interface CreateHospitalModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (hospital: { id: number; name: string; subdomain: string }) => void;
}

export default function CreateHospitalModal({ open, onClose, onCreated }: CreateHospitalModalProps) {
  const [name, setName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () =>
      api.hospitals.create({
        name: name.trim(),
        subdomain: subdomain.trim().toLowerCase(),
        adminEmail: adminEmail.trim() || undefined,
        adminName: adminName.trim() || undefined,
        adminPassword: adminPassword || undefined,
      }),
    onSuccess: (res) => {
      onCreated(res.hospital);
      toast('success', 'Hospital created');
      reset();
      onClose();
    },
    onError: (err: Error) => toast('error', err.message || 'Failed to create hospital'),
  });

  const reset = () => {
    setName('');
    setSubdomain('');
    setAdminEmail('');
    setAdminName('');
    setAdminPassword('');
  };

  if (!open) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-hospital-title"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="create-hospital-title" className="text-lg font-semibold text-slate-900">
            Add Hospital
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label htmlFor="ch-name" className="block text-sm font-medium text-slate-700 mb-1">
            Hospital name
          </label>
          <input
            id="ch-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>

        <div>
          <label htmlFor="ch-subdomain" className="block text-sm font-medium text-slate-700 mb-1">
            Subdomain
          </label>
          <input
            id="ch-subdomain"
            type="text"
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value)}
            required
            placeholder="e.g. city"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="ch-admin-email" className="block text-sm font-medium text-slate-700 mb-1">
              Admin email
            </label>
            <input
              id="ch-admin-email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <div>
            <label htmlFor="ch-admin-name" className="block text-sm font-medium text-slate-700 mb-1">
              Admin name
            </label>
            <input
              id="ch-admin-name"
              type="text"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="ch-admin-password" className="block text-sm font-medium text-slate-700 mb-1">
            Admin password
          </label>
          <input
            id="ch-admin-password"
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || mutation.isPending}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium"
          >
            {mutation.isPending ? 'Creating…' : 'Create Hospital'}
          </button>
        </div>
      </form>
    </div>
  );
}

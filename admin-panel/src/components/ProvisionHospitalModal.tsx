import { useState, useEffect, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useToast } from './Toast';
import { X } from 'lucide-react';
import { api } from '../services/api';

export interface ProvisionRequest {
  id: string;
  hospitalName: string;
  contactName: string;
  contactEmail: string;
}

interface ProvisionHospitalModalProps {
  request: ProvisionRequest | null;
  onClose: () => void;
  onProvisioned: (res: {
    hospital: { id: number; name: string; slug: string };
    credentials: { email: string; password: string };
  }) => void;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export default function ProvisionHospitalModal({
  request,
  onClose,
  onProvisioned,
}: ProvisionHospitalModalProps) {
  const [slug, setSlug] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [plan, setPlan] = useState<'starter' | 'professional' | 'enterprise'>('starter');
  const { toast } = useToast();

  useEffect(() => {
    if (request) {
      setAdminName(request.contactName);
      setAdminEmail(request.contactEmail);
      setSlug('');
    }
  }, [request]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!request) throw new Error('No request selected');
      return api.onboarding.provision(request.id, {
        slug: slug.trim().toLowerCase(),
        adminEmail: adminEmail.trim(),
        adminName: adminName.trim(),
        plan,
      });
    },
    onSuccess: (res) => {
      onProvisioned({
        hospital: {
          id: (res.hospital as { id: number }).id,
          name: (res.hospital as { name: string }).name,
          slug: cleanSlug,
        },
        credentials: res.credentials as { email: string; password: string },
      });
      toast('success', 'Hospital provisioned');
      onClose();
    },
    onError: (err: Error) => toast('error', err.message || 'Failed to provision hospital'),
  });

  if (!request) return null;

  const cleanSlug = slug.trim().toLowerCase();
  const isValidSlug = cleanSlug.length >= 3 && SLUG_RE.test(cleanSlug);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isValidSlug) return;
    mutation.mutate();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="provision-hospital-title"
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="provision-hospital-title" className="text-lg font-semibold text-slate-900">
            Provision {request.hospitalName}
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
          <label htmlFor="pr-slug" className="block text-sm font-medium text-slate-700 mb-1">
            Slug (subdomain)
          </label>
          <input
            id="pr-slug"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
            placeholder="e.g. sunrise"
            autoComplete="off"
            spellCheck={false}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="pr-admin-name" className="block text-sm font-medium text-slate-700 mb-1">
              Admin name
            </label>
            <input
              id="pr-admin-name"
              type="text"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
          <div>
            <label htmlFor="pr-admin-email" className="block text-sm font-medium text-slate-700 mb-1">
              Admin email
            </label>
            <input
              id="pr-admin-email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
          </div>
        </div>

        <div>
          <label htmlFor="pr-plan" className="block text-sm font-medium text-slate-700 mb-1">
            Plan
          </label>
          <select
            id="pr-plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value as 'starter' | 'professional' | 'enterprise')}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
          >
            <option value="starter">Starter</option>
            <option value="professional">Professional</option>
            <option value="enterprise">Enterprise</option>
          </select>
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
            disabled={!isValidSlug || mutation.isPending}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium"
          >
            {mutation.isPending ? 'Provisioning…' : 'Provision Hospital'}
          </button>
        </div>
      </form>
    </div>
  );
}

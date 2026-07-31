import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Activity, ArrowRight, KeyRound, Lock, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPatientPortalTopLevelPath } from '../lib/patientPortalRouting';

interface PatientAuthUser {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  national_id?: string | null;
  uhid: string | null;
  emailVerified: boolean;
}

interface PatientAuthResponse {
  user?: PatientAuthUser;
  error?: string;
  message?: string;
}

const PATIENT_STORAGE_KEY = 'global_patient_user';
const phonePattern = /^01\d{9}$/;
const claimCodePattern = /^C-[A-Z2-9]{6}$/;

export default function PatientCardClaimPage() {
  const [searchParams] = useSearchParams();
  const [uhid, setUhid] = useState(searchParams.get('uhid') ?? '');
  const [claimCode, setClaimCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const normalizedClaimCode = claimCode.trim().toUpperCase();
  const phoneError = phone && !phonePattern.test(phone.trim()) ? 'Use a Bangladeshi mobile number like 01812345678.' : '';
  const codeError = normalizedClaimCode && !claimCodePattern.test(normalizedClaimCode) ? 'Use the printed format C-XXXXXX.' : '';
  const passwordError = confirmPassword && password !== confirmPassword ? 'Passwords do not match.' : '';
  const contactReady = Boolean(phone.trim() || email.trim());
  const canSubmit = Boolean(
    uhid.trim()
      && normalizedClaimCode
      && contactReady
      && password
      && confirmPassword
      && !phoneError
      && !codeError
      && !passwordError,
  );

  const helperText = useMemo(() => {
    if (!contactReady) return 'Add mobile or email so you can sign in again later.';
    if (phoneError) return phoneError;
    if (codeError) return codeError;
    if (passwordError) return passwordError;
    return 'Your hospital-created profile will become your patient portal account.';
  }, [codeError, contactReady, passwordError, phoneError]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setLoading(true);

    try {
      const payload = {
        uhid: uhid.trim(),
        claim_code: normalizedClaimCode,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        password,
      };

      const response = await fetch('/api/patient-auth/claim-card', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json() as PatientAuthResponse;
      if (!response.ok || !data.user) {
        throw new Error(data.error || data.message || 'Could not claim this card.');
      }

      localStorage.setItem(PATIENT_STORAGE_KEY, JSON.stringify(data.user));
      toast.success('Card claimed');
      window.location.replace(getPatientPortalTopLevelPath('home'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not claim this card.';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 lg:flex-row lg:items-center lg:gap-12">
        <section className="lg:w-1/2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500">
              <Activity className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-lg font-bold tracking-tight">Ozzyl Health</p>
              <p className="text-xs text-slate-400">Universal Patient Access</p>
            </div>
          </div>

          <div className="mt-10 max-w-lg">
            <span className="inline-flex items-center gap-2 rounded-full border border-teal-400/30 bg-teal-400/10 px-4 py-1.5 text-xs font-semibold text-teal-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              Staff-assisted card claim
            </span>
            <h1 className="mt-5 text-3xl font-bold leading-tight sm:text-4xl">Claim your hospital health card</h1>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Use the UHID and claim code printed by hospital staff. This links the existing hospital-created profile to your portal login.
            </p>
            <p className="mt-5 text-xs text-slate-500">
              Already claimed it? <Link to="/patient/login" className="font-semibold text-cyan-300 hover:text-cyan-200">Sign in</Link>
            </p>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-800 bg-white p-5 text-slate-900 shadow-2xl lg:mt-0 lg:w-1/2 lg:p-7">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="claim-uhid" className="mb-1.5 block text-sm font-medium text-slate-700">Health card UHID</label>
              <input
                id="claim-uhid"
                value={uhid}
                onChange={(event) => setUhid(event.target.value.toUpperCase())}
                placeholder="OZ-000001"
                required
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
              />
            </div>

            <div>
              <label htmlFor="claim-code" className="mb-1.5 block text-sm font-medium text-slate-700">Claim code</label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="claim-code"
                  value={claimCode}
                  onChange={(event) => setClaimCode(event.target.value.toUpperCase())}
                  placeholder="C-8F4K2Q"
                  required
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 pl-10 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                />
              </div>
            </div>

            <div>
              <label htmlFor="claim-name" className="mb-1.5 block text-sm font-medium text-slate-700">Name</label>
              <div className="relative">
                <UserRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="claim-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 pl-10 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="claim-phone" className="mb-1.5 block text-sm font-medium text-slate-700">Mobile number</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="claim-phone"
                    type="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="01812345678"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 pl-10 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="claim-email" className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="claim-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 pl-10 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="claim-password" className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="claim-password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    minLength={8}
                    required
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 pl-10 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="claim-confirm-password" className="mb-1.5 block text-sm font-medium text-slate-700">Confirm password</label>
                <input
                  id="claim-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={8}
                  required
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:ring-4 focus:ring-cyan-100"
                />
              </div>
            </div>

            <p className={`text-sm ${phoneError || codeError || passwordError || !contactReady ? 'text-amber-700' : 'text-slate-500'}`}>
              {helperText}
            </p>

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-cyan-700 disabled:opacity-60"
            >
              {loading ? 'Claiming...' : 'Claim card'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}

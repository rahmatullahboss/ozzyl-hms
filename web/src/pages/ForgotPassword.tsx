import { useState } from 'react';
import { Link } from 'react-router';
import { Mail, ArrowLeft, ShieldCheck } from 'lucide-react';
import { api } from '../lib/apiClient';

const DEFAULT_CONFIRMATION = 'If an active account exists for that email, a password reset link has been sent.';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.post<{ message?: string }>('/api/auth/forgot-password', {
        email: email.trim(),
      });
      setMessage(response.message ?? DEFAULT_CONFIRMATION);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to request a password reset link.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <section className="mx-auto w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/50 dark:border-slate-800 dark:bg-slate-900 dark:shadow-none sm:p-8">
        <div className="mb-8 flex items-center gap-3">
          <img src="/ozzyl-logo.svg" alt="Ozzyl" className="h-10 w-10 rounded-xl" />
          <div>
            <p className="font-bold text-slate-900 dark:text-white">Ozzyl Health</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Hospital staff account recovery</p>
          </div>
        </div>

        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Reset your password</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
          Enter your staff account email. The reset link will be sent directly to that address.
        </p>

        {message ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            {message}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label htmlFor="reset-email" className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Email address
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  id="reset-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-slate-900 outline-none transition focus:border-cyan-500 focus:ring-4 focus:ring-cyan-100 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:ring-cyan-950"
                  placeholder="staff@example.com"
                />
              </div>
            </div>

            {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-cyan-600 px-4 py-3 font-semibold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <Link to="/login" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-cyan-700 hover:text-cyan-800 dark:text-cyan-300">
          <ArrowLeft className="h-4 w-4" />
          Back to staff login
        </Link>
      </section>
    </main>
  );
}

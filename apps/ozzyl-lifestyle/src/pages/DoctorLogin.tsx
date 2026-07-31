import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

const API = import.meta.env.VITE_API_URL || '';

export default function DoctorLogin() {
  const navigate = useNavigate();
  const [loginWith, setLoginWith] = useState<'email' | 'phone'>('email');
  const [credential, setCredential] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credential.trim() || !password) { setError('All fields are required'); return; }
    setLoading(true);
    setError('');
    try {
      const body: Record<string, string> = { password };
      body[loginWith] = credential;

      const res = await fetch(`${API}/api/v1/doctor-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed');
        return;
      }
      localStorage.setItem('doctor_token', data.token);
      localStorage.setItem('doctor_tenant_id', data.tenant_id);
      // Redirect to chamber dashboard — need to get slug from /me or store it
      // For now navigate to login redirect logic
      const meRes = await fetch(`${API}/api/v1/doctor-auth/me`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (meRes.ok) {
        const meData = await meRes.json();
        navigate(`/h/${meData.doctor.slug}/dashboard`);
      } else {
        navigate('/');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">🩺</div>
          <h1 className="text-2xl font-bold text-gray-900">Doctor Login</h1>
          <p className="text-sm text-gray-500 mt-1">Access your chamber dashboard</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Toggle email/phone */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              <button
                type="button"
                onClick={() => { setLoginWith('email'); setCredential(''); }}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${loginWith === 'email' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Email
              </button>
              <button
                type="button"
                onClick={() => { setLoginWith('phone'); setCredential(''); }}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${loginWith === 'phone' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Phone
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {loginWith === 'email' ? 'Email' : 'Phone Number'}
              </label>
              <input
                type={loginWith === 'email' ? 'email' : 'tel'}
                value={credential}
                onChange={e => setCredential(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder={loginWith === 'email' ? 'doctor@example.com' : '+8801XXXXXXXXX'}
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 mt-4">
          New doctor?{' '}
          <Link to="/doctor/register" className="text-blue-600 hover:underline">Register your chamber</Link>
        </p>
        <p className="text-center text-xs text-gray-400 mt-2">
          <Link to="/marketplace" className="hover:text-gray-600">← Back to Marketplace</Link>
        </p>
      </div>
    </div>
  );
}

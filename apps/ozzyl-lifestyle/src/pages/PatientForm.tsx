import { useState } from 'react';
import { useNavigate, Link, useParams } from 'react-router';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { getRoleBasePath } from '../lib/handover';

export default function PatientForm({ role = 'hospital_admin' }: { role?: string }) {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const base = getRoleBasePath(slug ?? '', role);
  const { t } = useTranslation(['patients', 'common']);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    fatherHusband: '',
    address: '',
    mobile: '',
    guardianMobile: '',
    age: '',
    gender: '',
    bloodGroup: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const payload = {
        name: formData.name,
        fatherHusband: formData.fatherHusband,
        address: formData.address,
        mobile: formData.mobile,
        guardianMobile: formData.guardianMobile || undefined,
        age: formData.age ? parseInt(formData.age, 10) : undefined,
        gender: formData.gender || undefined,
        bloodGroup: formData.bloodGroup || undefined,
      };
      const { data } = await axios.post('/api/patients', payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      toast.success(`${t('patientRegistered', { defaultValue: 'Patient registered! Serial:' })} ${data.serial}`);
      navigate(`${base}/patients`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || t('registrationFailed', { defaultValue: 'Failed to register patient' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout role={role}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link to={`${base}/patients`} className="text-gray-600 hover:text-gray-800">
            ← {t('back', { ns: 'common' })}
          </Link>
          <h1 className="text-2xl font-bold">{t('newPatient')}</h1>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('name', { ns: 'common' })} *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('fatherHusband', { defaultValue: 'Father/Husband Name' })} *</label>
              <input
                type="text"
                required
                value={formData.fatherHusband}
                onChange={(e) => setFormData({ ...formData, fatherHusband: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('address')} *</label>
              <input
                type="text"
                required
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('phone', { ns: 'common' })} *</label>
              <input
                type="tel"
                required
                value={formData.mobile}
                onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('guardianMobile', { defaultValue: 'Guardian Mobile' })}</label>
              <input
                type="tel"
                value={formData.guardianMobile}
                onChange={(e) => setFormData({ ...formData, guardianMobile: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('age')}</label>
              <input
                type="number"
                value={formData.age}
                onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('gender')}</label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">{t('select', { ns: 'common', defaultValue: 'Select' })}</option>
                <option value="male">{t('male')}</option>
                <option value="female">{t('female')}</option>
                <option value="other">{t('other')}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('bloodGroup')}</label>
              <select
                value={formData.bloodGroup}
                onChange={(e) => setFormData({ ...formData, bloodGroup: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">{t('select', { ns: 'common', defaultValue: 'Select' })}</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-4 sm:justify-end">
            <button
              type="submit"
              disabled={loading}
              className="btn-primary sm:min-w-[180px] justify-center"
            >
              {loading ? t('loading', { ns: 'common' }) : t('registerPatient', { defaultValue: 'Register Patient' })}
            </button>
            <Link
              to={`${base}/patients`}
              className="btn-secondary sm:min-w-[120px] justify-center"
            >
              {t('cancel', { ns: 'common' })}
            </Link>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Camera, Save, Lock, User, Mail, Phone, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { compressImage } from '../lib/compressImage';
import { apiFetch } from '../lib/apiClient';

interface UserProfile {
  id: number;
  name: string;
  email: string;
  phone?: string;
  mobile?: string;
  role: string;
  photo_url?: string;
  department?: string;
  username?: string;
}

export default function ProfilePage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['common', 'settings']);
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Password change
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const passwordStrengthHint = t('passwordStrengthHint', {
    defaultValue: 'Password must be at least 8 characters and include uppercase, lowercase, and number',
  });

  // Fetch current user profile
  const { data: profile, isLoading } = useApiQuery<UserProfile>(
    ['user-profile'],
    '/api/users/me',
  );

  // Populate form when profile loads
  useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setEmail(profile.email || '');
      setPhone(profile.mobile || profile.phone || '');
      setPhotoUrl(profile.photo_url || null);
    }
  }, [profile]);

  // Update profile mutation
  const updateProfile = useApiMutation<{ message: string }, { name: string; email: string; phone: string }>(
    'put',
    '/api/users/me',
    {
      onSuccess: () => {
        toast.success(t('profileUpdated', { defaultValue: 'Profile updated' }));
        queryClient.invalidateQueries({ queryKey: ['user-profile'] });
      },
      onError: (err) => toast.error(err.message),
    },
  );

  // Change password mutation
  const changePassword = useApiMutation<{ message: string }, { current_password: string; new_password: string }>(
    'put',
    '/api/users/me/password',
    {
      onSuccess: () => {
        toast.success(t('passwordChanged', { defaultValue: 'Password changed' }));
        setShowPasswordForm(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      },
      onError: (err) => toast.error(err.message),
    },
  );

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type. Backend enforces the same allowlist; SVG is blocked.
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error(t('invalidImage', { defaultValue: 'Please select a JPG, PNG, or WebP image' }));
      return;
    }

    // Validate file size (max 10MB before compression)
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('imageTooLarge', { defaultValue: 'Image is too large (max 10MB)' }));
      return;
    }

    setUploading(true);
    try {
      // Compress image in browser
      const compressed = await compressImage(file, 400, 0.8);

      // Create preview
      const previewUrl = URL.createObjectURL(compressed);
      setPhotoPreview(previewUrl);

      // Upload compressed image
      const formData = new FormData();
      formData.append('photo', compressed, file.name);

      const res = await apiFetch<{ photo_url: string }>('/api/users/me/photo', {
        method: 'POST',
        body: formData,
      });

      setPhotoUrl(res.photo_url);
      setPhotoPreview(null);
      toast.success(t('photoUploaded', { defaultValue: 'Photo uploaded' }));
      queryClient.invalidateQueries({ queryKey: ['user-profile'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('uploadFailed', { defaultValue: 'Upload failed' }));
      setPhotoPreview(null);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveProfile = () => {
    if (!name.trim()) {
      toast.error(t('nameRequired', { defaultValue: 'Name is required' }));
      return;
    }
    updateProfile.mutate({ name: name.trim(), email: email.trim(), phone: phone.trim() });
  };

  const handleChangePassword = () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error(t('fillAllFields', { defaultValue: 'Please fill all fields' }));
      return;
    }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      toast.error(passwordStrengthHint);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('passwordMismatch', { defaultValue: 'Passwords do not match' }));
      return;
    }
    changePassword.mutate({ current_password: currentPassword, new_password: newPassword });
  };

  const displayPhoto = photoPreview || photoUrl;
  const avatarInitial = (name || 'U').trim()[0]?.toUpperCase() ?? 'U';

  return (
    <DashboardLayout role={role}>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">{t('myProfile', { defaultValue: 'My Profile' })}</h1>

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Photo Section */}
            <div className="card p-6">
              <div className="flex items-center gap-6">
                <div className="relative">
                  {displayPhoto ? (
                    <img
                      src={displayPhoto}
                      alt={name}
                      className="w-24 h-24 rounded-full object-cover border-2 border-[var(--color-border)]"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-cyan-400 flex items-center justify-center text-white text-3xl font-bold">
                      {avatarInitial}
                    </div>
                  )}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center shadow-lg hover:bg-[var(--color-primary-dark)] transition-colors cursor-pointer disabled:opacity-50"
                    title={t('changePhoto', { defaultValue: 'Change photo' })}
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handlePhotoSelect}
                    className="hidden"
                  />
                </div>
                <div>
                  <p className="text-lg font-semibold text-[var(--color-text)]">{name || profile?.email}</p>
                  <p className="text-sm text-[var(--color-text-muted)] capitalize">{profile?.role?.replace(/_/g, ' ')}</p>
                  {uploading && <p className="text-xs text-[var(--color-primary)] mt-1">{t('compressing', { defaultValue: 'Compressing & uploading...' })}</p>}
                </div>
              </div>
            </div>

            {/* Profile Info */}
            <div className="card p-6 space-y-4">
              <h2 className="font-semibold text-[var(--color-text)]">{t('profileInfo', { defaultValue: 'Profile Information' })}</h2>

              <div>
                <label className="label">{t('name', { defaultValue: 'Name' })}</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="input pl-10"
                    placeholder={t('yourName', { defaultValue: 'Your name' })}
                  />
                </div>
              </div>

              <div>
                <label className="label">{t('email', { defaultValue: 'Email' })}</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input pl-10"
                    placeholder="email@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="label">{t('phone', { defaultValue: 'Mobile' })}</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="input pl-10"
                    placeholder="01XXXXXXXXX"
                  />
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {t('mobileLoginHint', { defaultValue: 'Used for mobile number login' })}
                </p>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveProfile}
                  disabled={updateProfile.isPending}
                  className="btn-primary"
                >
                  <Save className="w-4 h-4" />
                  {updateProfile.isPending ? t('saving', { defaultValue: 'Saving...' }) : t('save', { defaultValue: 'Save' })}
                </button>
              </div>
            </div>

            {/* Password Change */}
            <div className="card p-6">
              <button
                onClick={() => setShowPasswordForm(!showPasswordForm)}
                className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-primary)] transition-colors cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                {t('changePassword', { defaultValue: 'Change Password' })}
              </button>

              {showPasswordForm && (
                <div className="mt-4 space-y-4">
                  <div>
                    <label className="label">{t('currentPassword', { defaultValue: 'Current Password' })}</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                      <input
                        type={showCurrentPw ? 'text' : 'password'}
                        name="current-password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="input pl-10 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowCurrentPw(!showCurrentPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                      >
                        {showCurrentPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="label">{t('newPassword', { defaultValue: 'New Password' })}</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                      <input
                        type={showNewPw ? 'text' : 'password'}
                        name="new-password"
                        autoComplete="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="input pl-10 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPw(!showNewPw)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer"
                      >
                        {showNewPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{passwordStrengthHint}</p>
                  </div>

                  <div>
                    <label className="label">{t('confirmPassword', { defaultValue: 'Confirm Password' })}</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                      <input
                        type="password"
                        name="confirm-password"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="input pl-10"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button onClick={() => setShowPasswordForm(false)} className="btn-secondary">
                      {t('cancel', { defaultValue: 'Cancel' })}
                    </button>
                    <button
                      onClick={handleChangePassword}
                      disabled={changePassword.isPending}
                      className="btn-primary"
                    >
                      {changePassword.isPending ? t('saving', { defaultValue: 'Saving...' }) : t('updatePassword', { defaultValue: 'Update Password' })}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

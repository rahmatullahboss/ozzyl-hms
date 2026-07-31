import { useState } from 'react';
import {
  Globe, Save, Palette, Type, Eye, RefreshCw, Plus, Trash2, ChevronRight, ExternalLink,
  Upload, X, Image, FileText, Star, Building2, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api, apiFetch } from '../lib/apiClient';
import { formatDisplayDate } from '../lib/date-utils';

// ── Types ──
interface WebsiteConfig {
  is_enabled: number;
  theme: string;
  tagline: string;
  tagline_bn: string;
  about_text: string;
  about_text_bn: string;
  mission_text: string;
  mission_text_bn: string;
  founded_year: string;
  bed_count: string;
  operating_hours: string;
  google_maps_embed: string;
  whatsapp_number: string;
  facebook_url: string;
  emergency_number: string;
  ambulance_number: string;
  emergency_hours: string;
  seo_title: string;
  seo_description: string;
  seo_keywords: string;
  primary_color: string;
  secondary_color: string;
  hospital_logo_url?: string | null;
}

interface WebsiteService {
  id?: number;
  name: string;
  name_bn: string;
  description: string;
  icon: string;
  category: string;
  is_active: number;
  sort_order: number;
}

interface GalleryImage {
  id: number;
  image_key: string;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

interface BlogPost {
  id: number;
  title: string;
  title_bn: string;
  slug: string;
  content: string;
  content_bn: string;
  excerpt: string;
  featured_image_key: string | null;
  author_name: string;
  is_published: number;
  published_at: string | null;
}

interface Review {
  id: number;
  patient_name: string;
  rating: number;
  review_text: string | null;
  is_approved: number;
  created_at: string;
}

interface Department {
  id?: number;
  name: string;
  name_bn: string;
  slug: string;
  description: string;
  description_bn: string;
  icon: string;
  is_active: number;
  sort_order: number;
}

type Tab = 'general' | 'services' | 'gallery' | 'blog' | 'reviews' | 'departments' | 'seo' | 'appearance';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'general',     label: 'General',     icon: <Globe className="w-4 h-4" /> },
  { id: 'services',    label: 'Services',    icon: <Plus className="w-4 h-4" /> },
  { id: 'gallery',     label: 'Gallery',     icon: <Image className="w-4 h-4" /> },
  { id: 'blog',        label: 'Blog',        icon: <FileText className="w-4 h-4" /> },
  { id: 'reviews',     label: 'Reviews',     icon: <Star className="w-4 h-4" /> },
  { id: 'departments', label: 'Departments', icon: <Building2 className="w-4 h-4" /> },
  { id: 'seo',         label: 'SEO',         icon: <Eye className="w-4 h-4" /> },
  { id: 'appearance',  label: 'Appearance',  icon: <Palette className="w-4 h-4" /> },
];

const THEMES = [
  { id: 'arogyaseva', name: 'ArogyaSeva', desc: 'Teal + White — Modern clinics', color: '#0891b2' },
  { id: 'medtrust',   name: 'MedTrust',   desc: 'Navy + Gold — Established hospitals', color: '#1e3a5f' },
  { id: 'carefirst',  name: 'CareFirst',  desc: 'Green + Warm — Community clinics', color: '#16a34a' },
  { id: 'sunrise',    name: 'Sunrise',    desc: 'Orange + Pink — Women & children', color: '#ea580c' },
  { id: 'oceanic',    name: 'Oceanic',    desc: 'Blue — Multi-specialty', color: '#1d4ed8' },
  { id: 'heritage',   name: 'Heritage',   desc: 'Maroon + Cream — Government/Traditional', color: '#7c2d12' },
  { id: 'minimal',    name: 'Minimal',    desc: 'Black + White — Private clinics', color: '#171717' },
  { id: 'nature',     name: 'Nature',     desc: 'Earth tones — Ayurvedic/Wellness', color: '#4d7c0f' },
];

const SERVICE_CATEGORIES = ['general', 'opd', 'ipd', 'lab', 'pharmacy', 'telemedicine', 'emergency'];

const DEFAULT_CONFIG: WebsiteConfig = {
  is_enabled: 1, theme: 'arogyaseva', tagline: '', tagline_bn: '',
  about_text: '', about_text_bn: '', mission_text: '', mission_text_bn: '',
  founded_year: '', bed_count: '', operating_hours: '', google_maps_embed: '',
  whatsapp_number: '', facebook_url: '',
  emergency_number: '', ambulance_number: '', emergency_hours: '',
  seo_title: '', seo_description: '',
  seo_keywords: '', primary_color: '#0891b2', secondary_color: '#059669',
};

function Field({ label, value, onChange, type = 'text', placeholder, hint, rows }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; hint?: string; rows?: number;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {rows ? (
        <textarea className="input" value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} rows={rows} style={{ resize: 'vertical' }} />
      ) : (
        <input type={type} className="input" value={value}
          onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      )}
      {hint && <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

function ImageUpload({ label, endpoint, deleteEndpoint, onUpload }: {
  label: string; endpoint: string; deleteEndpoint: string;
  onUpload: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const { t } = useTranslation('settings');

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast.error(t('ws.fileTooLarge2mb')); return; }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await apiFetch<{ url: string }>(endpoint, {
        method: 'POST',
        body: formData,
        headers: { 'Content-Type': '' },
      });
      setPreview(res.url);
      toast.success(t('ws.uploadSuccess', { label }));
      onUpload();
    } catch {
      toast.error(t('ws.uploadFailed', { label }));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(deleteEndpoint);
      setPreview(null);
      toast.success(t('ws.removeSuccess', { label }));
      onUpload();
    } catch {
      toast.error(t('ws.removeFailed'));
    }
  };

  return (
    <div>
      <label className="label">{label}</label>
      <div className="border-2 border-dashed border-[var(--color-border)] rounded-lg p-4 text-center relative">
        {preview ? (
          <div className="relative">
            <img src={preview} alt={label} className="max-h-24 mx-auto rounded" />
            <button onClick={handleDelete} className="absolute top-0 right-0 p-1 bg-red-100 rounded-full text-red-600 hover:bg-red-200">
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <>
            <Upload className="w-6 h-6 mx-auto text-[var(--color-text-muted)] mb-1" />
            <p className="text-xs text-[var(--color-text-muted)]">{uploading ? t('ws.uploading') : t('ws.clickOrDrag')}</p>
          </>
        )}
        <input type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" className="absolute inset-0 opacity-0 cursor-pointer"
          onChange={handleUpload} disabled={uploading} />
      </div>
    </div>
  );
}

export default function WebsiteSettings({ role = 'hospital_admin' }: { role?: string }) {
  const [config, setConfig] = useState<WebsiteConfig>(DEFAULT_CONFIG);
  const [galleryUploading, setGalleryUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [newService, setNewService] = useState<WebsiteService>({
    name: '', name_bn: '', description: '', icon: '\u{1F3E5}', category: 'general', is_active: 1, sort_order: 0,
  });
  const [newDept, setNewDept] = useState<Department>({
    name: '', name_bn: '', slug: '', description: '', description_bn: '', icon: '\u{1F3E5}', is_active: 1, sort_order: 0,
  });
  const [blogModal, setBlogModal] = useState<{ open: boolean; post: Partial<BlogPost> | null }>({ open: false, post: null });
  const { t } = useTranslation(['settings', 'common']);
  const { t: tWs } = useTranslation('settings');
  const queryClient = useQueryClient();

  // Queries
  const { data: configData, isLoading: configLoading } = useApiQuery<{ data: WebsiteConfig }>(
    queryKeys.website.config(),
    '/api/website/config',
  );
  const { data: servicesData } = useApiQuery<{ data: WebsiteService[] }>(
    queryKeys.website.services(),
    '/api/website/services',
  );
  const { data: galleryData } = useApiQuery<{ data: GalleryImage[] }>(
    queryKeys.website.gallery(),
    '/api/website/gallery',
  );
  const { data: blogData } = useApiQuery<{ data: BlogPost[] }>(
    queryKeys.website.blogPosts(),
    '/api/website/blog-posts',
  );
  const { data: reviewsData } = useApiQuery<{ data: Review[] }>(
    queryKeys.website.reviews(),
    '/api/website/reviews',
  );
  const { data: deptData } = useApiQuery<{ data: Department[] }>(
    queryKeys.website.departments(),
    '/api/website/departments',
  );

  // Merge fetched config into local state (only on first load)
  const [configInitialized, setConfigInitialized] = useState(false);
  if (configData?.data && !configInitialized) {
    setConfig(c => ({ ...c, ...configData.data }));
    setConfigInitialized(true);
  }

  const services = servicesData?.data ?? [];
  const gallery = galleryData?.data ?? [];
  const blogPosts = blogData?.data ?? [];
  const reviews = reviewsData?.data ?? [];
  const departments = deptData?.data ?? [];
  const loading = configLoading;

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.website.all });
  };

  // Mutations
  const saveConfigMutation = useApiMutation<unknown, Record<string, unknown>>('put', '/api/website/config', {
    onSuccess: () => {
      toast.success(tWs('ws.settingsSaved'));
      invalidateAll();
    },
    onError: () => toast.error(tWs('ws.settingsSaveFailed')),
  });

  const addServiceMutation = useApiMutation<unknown, WebsiteService>('post', '/api/website/services', {
    onSuccess: () => {
      toast.success(tWs('ws.serviceAdded'));
      setNewService({ name: '', name_bn: '', description: '', icon: '\u{1F3E5}', category: 'general', is_active: 1, sort_order: 0 });
      invalidateAll();
    },
    onError: () => toast.error(tWs('ws.serviceAddFailed')),
  });

  const deleteServiceMutation = useApiMutation<unknown, number>('delete', (id) => `/api/website/services/${id}`, {
    onSuccess: () => { toast.success(tWs('ws.serviceDeleted')); invalidateAll(); },
    onError: () => toast.error(tWs('ws.deleteFailed')),
  });

  const handleSaveConfig = async () => {
    setSaving(true);
    const payload: Record<string, unknown> = { ...config };
    if (payload.founded_year) payload.founded_year = Number(payload.founded_year) || null;
    else payload.founded_year = null;
    if (payload.bed_count) payload.bed_count = Number(payload.bed_count) || null;
    else payload.bed_count = null;
    if (!payload.google_maps_embed) delete payload.google_maps_embed;
    if (!payload.facebook_url) delete payload.facebook_url;
    try {
      await saveConfigMutation.mutateAsync(payload);
    } finally {
      setSaving(false);
    }
  };

  const handleAddService = async () => {
    if (!newService.name.trim()) { toast.error(tWs('ws.serviceNameRequired')); return; }
    addServiceMutation.mutate(newService);
  };

  const handleDeleteService = async (id: number) => {
    if (!confirm(tWs('ws.confirmDeleteService'))) return;
    deleteServiceMutation.mutate(id);
  };

  const handleTriggerRender = async () => {
    setRendering(true);
    try {
      await api.post('/api/website/trigger-render', {});
      toast.success(tWs('ws.rerenderTriggered'));
    } catch {
      toast.error(tWs('ws.rerenderFailed'));
    } finally {
      setRendering(false);
    }
  };

  // Derive subdomain from current hostname for public URL
  const getPublicUrl = () => {
    const host = window.location.hostname;
    if (host.startsWith('hms-')) return `https://${host}/site`;
    return '/site';
  };

  const sc = (k: keyof WebsiteConfig) => (v: string) => setConfig(prev => ({ ...prev, [k]: v }));
  const ns = (k: keyof WebsiteService) => (v: string | number) => setNewService(prev => ({ ...prev, [k]: v }));

  const tabContent: Record<Tab, React.ReactNode> = {
    general: (
      <div className="space-y-4">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--color-border-light)]">
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">Website Enabled</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Toggle public website visibility
            </p>
          </div>
          <button type="button" role="switch" aria-checked={!!config.is_enabled}
            onClick={() => setConfig(c => ({ ...c, is_enabled: c.is_enabled ? 0 : 1 }))}
            className={`relative w-10 h-6 rounded-full transition-colors ${
              config.is_enabled ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'
            }`}>
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
              config.is_enabled ? 'right-1' : 'left-1'
            }`} />
          </button>
        </div>

        <Field label="Hospital Tagline (English)" value={config.tagline || ''} onChange={sc('tagline')}
          placeholder={tWs('ws.placeholderTagline')} hint={tWs('ws.hintTagline')} />
        <Field label="Hospital Tagline (Bengali)" value={config.tagline_bn || ''} onChange={sc('tagline_bn')}
          placeholder={tWs('ws.placeholderTaglineBn')} hint={tWs('ws.hintTaglineBn')} />

        <div className="grid grid-cols-2 gap-4">
          <Field label="Founded Year" type="number" value={config.founded_year || ''} onChange={sc('founded_year')} placeholder={tWs('ws.placeholderFoundedYear')} />
          <Field label="Total Beds" type="number" value={config.bed_count || ''} onChange={sc('bed_count')} placeholder={tWs('ws.placeholderBedCount')} />
        </div>

        <Field label="Operating Hours" value={config.operating_hours || ''} onChange={sc('operating_hours')}
          placeholder={tWs('ws.placeholderOperatingHours')} />

        <div className="grid grid-cols-2 gap-4">
          <Field label="WhatsApp Number" value={config.whatsapp_number || ''} onChange={sc('whatsapp_number')}
            placeholder={tWs('ws.placeholderPhone')} />
          <Field label="Facebook URL" value={config.facebook_url || ''} onChange={sc('facebook_url')}
            placeholder={tWs('ws.placeholderFacebookUrl')} />
        </div>

        {/* Emergency Info */}
        <div className="pt-3 border-t border-[var(--color-border)]">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-3">{tWs('ws.emergencyInfo')}</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Emergency Number" value={config.emergency_number || ''} onChange={sc('emergency_number')}
              placeholder={tWs('ws.placeholderPhone')} hint={tWs('ws.hintEmergencyNumber')} />
            <Field label="Ambulance Number" value={config.ambulance_number || ''} onChange={sc('ambulance_number')}
              placeholder={tWs('ws.placeholderPhone')} />
          </div>
          <div className="mt-3">
            <Field label="Emergency Hours" value={config.emergency_hours || ''} onChange={sc('emergency_hours')}
              placeholder={tWs('ws.placeholderEmergencyHours')} hint={tWs('ws.hintEmergencyHours')} />
          </div>
        </div>

        <Field label="Google Maps Embed URL" value={config.google_maps_embed || ''} onChange={sc('google_maps_embed')}
          placeholder={tWs('ws.placeholderMapsEmbed')}
          hint={tWs('ws.hintMapsEmbed')} />

        {/* Content Section (merged from Content tab) */}
        <div className="pt-3 border-t border-[var(--color-border)]">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-3">{tWs('ws.websiteContent')}</p>
          <div className="space-y-4">
            <Field label="About Us (English)" value={config.about_text || ''} onChange={sc('about_text')} rows={4}
              placeholder={tWs('ws.placeholderAbout')}
              hint={tWs('ws.hintAbout')} />
            <Field label="About Us (Bengali)" value={config.about_text_bn || ''} onChange={sc('about_text_bn')} rows={4}
              placeholder={tWs('ws.placeholderAboutBn')}
              hint={tWs('ws.hintAboutBn')} />
            <Field label="Our Mission (English)" value={config.mission_text || ''} onChange={sc('mission_text')} rows={3}
              placeholder={tWs('ws.placeholderMission')}
              hint={tWs('ws.hintMission')} />
            <Field label="Our Mission (Bengali)" value={config.mission_text_bn || ''} onChange={sc('mission_text_bn')} rows={3}
              placeholder={tWs('ws.placeholderMissionBn')}
              hint={tWs('ws.hintMissionBn')} />
          </div>
        </div>

        {/* Image Uploads */}
        <div className="pt-3 border-t border-[var(--color-border)]">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-3">Images</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Logo</label>
              <div className="border-2 border-dashed border-[var(--color-border)] rounded-lg p-4 text-center">
                {config.hospital_logo_url ? (
                  <div className="flex flex-col items-center gap-2">
                    <img src={config.hospital_logo_url} alt="Hospital Logo" className="max-h-24 mx-auto rounded" />
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Managed in Settings → Hospital Logo
                    </p>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-6 h-6 mx-auto text-[var(--color-text-muted)] mb-1" />
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Upload logo in Settings → Hospital Logo
                    </p>
                  </div>
                )}
              </div>
            </div>
            <ImageUpload label="Hero Image" endpoint="/api/website/upload-hero" deleteEndpoint="/api/website/hero-image" onUpload={invalidateAll} />
          </div>
        </div>

        {/* Preview Link */}
        <div className="p-4 rounded-xl bg-gradient-to-r from-cyan-50 to-teal-50 dark:from-cyan-950/20 dark:to-teal-950/20 border border-cyan-200 dark:border-cyan-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-[var(--color-primary)]">Live Website</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5 font-mono">{getPublicUrl()}</p>
            </div>
            <a href={getPublicUrl()} target="_blank" rel="noopener noreferrer"
              className="btn-secondary text-xs !py-1.5 !px-3 flex items-center gap-1.5">
              <ExternalLink className="w-3.5 h-3.5" /> Open Website
            </a>
          </div>
        </div>
      </div>
    ),

    services: (
      <div className="space-y-4">
        {/* Existing Services */}
        {services.length > 0 ? (
          <div className="space-y-2">
            {services.map(svc => (
              <div key={svc.id} className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-border-light)]">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{svc.icon}</span>
                  <div>
                    <p className="text-sm font-medium">{svc.name}</p>
                    {svc.name_bn && <p className="text-xs text-[var(--color-text-muted)]">{svc.name_bn}</p>}
                    <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] bg-[var(--color-border)] px-1.5 py-0.5 rounded">
                      {svc.category}
                    </span>
                  </div>
                </div>
                <button onClick={() => svc.id && handleDeleteService(svc.id)}
                  className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-[var(--color-text-muted)]">
            <p className="text-sm">{tWs('ws.noServicesYet')}</p>
          </div>
        )}

        {/* Add New Service */}
        <div className="p-4 rounded-xl border border-dashed border-[var(--color-border)] space-y-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{tWs('ws.addNewService')}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name (English)" value={newService.name} onChange={v => ns('name')(v)} placeholder={tWs('ws.placeholderServiceNameEn')} />
            <Field label="Name (Bengali)" value={newService.name_bn} onChange={v => ns('name_bn')(v)} placeholder={tWs('ws.placeholderServiceNameBn')} />
          </div>
          <Field label="Description" value={newService.description} onChange={v => ns('description')(v)}
            placeholder={tWs('ws.placeholderServiceDesc')} rows={2} />
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">{tWs('ws.iconEmoji')}</label>
              <input className="input" value={newService.icon} onChange={e => ns('icon')(e.target.value)} placeholder={tWs('ws.placeholderIconEmoji')} />
            </div>
            <div>
              <label className="label">{tWs('ws.category')}</label>
              <select className="input" value={newService.category} onChange={e => ns('category')(e.target.value)}>
                {SERVICE_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={handleAddService} className="btn-primary w-full text-sm">
                <Plus className="w-4 h-4" /> {tWs('ws.add')}
              </button>
            </div>
          </div>
        </div>
      </div>
    ),

    gallery: (
      <div className="space-y-4">
        {/* Existing Gallery Images */}
        {gallery.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {gallery.map(img => (
              <div key={img.id} className="relative group rounded-lg overflow-hidden border border-[var(--color-border)]">
                <img src={`/api/uploads/${img.image_key}`} alt={img.caption || 'Gallery'}
                  className="w-full h-32 object-cover" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button onClick={async () => {
                    if (!confirm(tWs('ws.confirmDeleteImage'))) return;
                    try {
                      await api.delete(`/api/website/gallery/${img.id}`);
                      toast.success(tWs('ws.imageDeleted'));
                      invalidateAll();
                    } catch { toast.error(tWs('ws.deleteFailed')); }
                  }} className="p-2 bg-red-500 text-white rounded-full hover:bg-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                {img.caption && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs px-2 py-1 truncate">
                    {img.caption}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-[var(--color-text-muted)]">
            <Image className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{tWs('ws.noGalleryImages')}</p>
          </div>
        )}

        {/* Upload New Image */}
        <div className="p-4 rounded-xl border border-dashed border-[var(--color-border)] space-y-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{tWs('ws.addGalleryImage')}</p>
          <div className="border-2 border-dashed border-[var(--color-border)] rounded-lg p-6 text-center relative">
            <Upload className="w-6 h-6 mx-auto text-[var(--color-text-muted)] mb-1" />
            <p className="text-xs text-[var(--color-text-muted)]">
              {galleryUploading ? tWs('ws.uploading') : tWs('ws.clickToUploadGallery')}
            </p>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="absolute inset-0 opacity-0 cursor-pointer"
              disabled={galleryUploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 5 * 1024 * 1024) { toast.error(tWs('ws.fileTooLarge5mb')); return; }
                setGalleryUploading(true);
                const formData = new FormData();
                formData.append('file', file);
                formData.append('caption', '');
                formData.append('sort_order', String(gallery.length));
                try {
                  await apiFetch('/api/website/gallery', {
                    method: 'POST',
                    body: formData,
                    headers: { 'Content-Type': '' },
                  });
                  toast.success(tWs('ws.imageUploaded'));
                  invalidateAll();
                } catch { toast.error(tWs('ws.imageUploadFailed')); }
                finally { setGalleryUploading(false); }
              }} />
          </div>
        </div>
      </div>
    ),

    blog: (
      <div className="space-y-4">
        {/* Blog Posts List */}
        {blogPosts.length > 0 ? (
          <div className="space-y-2">
            {blogPosts.map(post => (
              <div key={post.id} className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-border-light)]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{post.title}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      post.is_published ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {post.is_published ? tWs('ws.published') : tWs('ws.draft')}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    /{post.slug} {post.author_name && `· by ${post.author_name}`}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setBlogModal({ open: true, post })}
                    className="text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] p-1.5 rounded-lg transition-colors">
                    <Type className="w-4 h-4" />
                  </button>
                  <button onClick={async () => {
                    if (!confirm(tWs('ws.confirmDeletePost'))) return;
                    try {
                      await api.delete(`/api/website/blog-posts/${post.id}`);
                      toast.success(tWs('ws.postDeleted'));
                      invalidateAll();
                    } catch { toast.error(tWs('ws.deleteFailed')); }
                  }} className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-[var(--color-text-muted)]">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{tWs('ws.noBlogPostsYet')}</p>
          </div>
        )}

        <button onClick={() => setBlogModal({ open: true, post: null })} className="btn-primary text-sm w-full">
          <Plus className="w-4 h-4" /> {tWs('ws.newBlogPost')}
        </button>

        {/* Blog Modal */}
        {blogModal.open && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && setBlogModal({ open: false, post: null })}>
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="border-b border-[var(--color-border)] p-4 flex items-center justify-between">
                <h3 className="font-semibold">{blogModal.post?.id ? tWs('ws.editPost') : tWs('ws.newBlogPostModal')}</h3>
                <button onClick={() => setBlogModal({ open: false, post: null })} className="p-1 hover:bg-[var(--color-border-light)] rounded">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form className="p-5 space-y-4" onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as HTMLFormElement;
                const fd = new FormData(form);
                const payload = {
                  title: blogModal.post?.title || '',
                  title_bn: blogModal.post?.title_bn || null,
                  slug: blogModal.post?.slug || '',
                  content: fd.get('content') as string,
                  content_bn: fd.get('content_bn') as string || null,
                  excerpt: fd.get('excerpt') as string || null,
                  author_name: blogModal.post?.author_name || null,
                  is_published: fd.get('is_published') ? 1 : 0,
                };
                try {
                  if (blogModal.post?.id) {
                    await api.put(`/api/website/blog-posts/${blogModal.post.id}`, payload);
                  } else {
                    await api.post('/api/website/blog-posts', payload);
                  }
                  toast.success(blogModal.post?.id ? tWs('ws.postUpdated') : tWs('ws.postCreated'));
                  setBlogModal({ open: false, post: null });
                  invalidateAll();
                } catch { toast.error(tWs('ws.savePostFailed')); }
              }}>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Title (English)" value={blogModal.post?.title || ''} onChange={(v) => setBlogModal(m => ({ ...m, post: { ...m.post, title: v } }))} placeholder={tWs('ws.placeholderBlogTitleEn')} />
                  <Field label="Title (Bengali)" value={blogModal.post?.title_bn || ''} onChange={(v) => setBlogModal(m => ({ ...m, post: { ...m.post, title_bn: v } }))} placeholder={tWs('ws.placeholderBlogTitleBn')} />
                </div>
                <Field label="URL Slug" value={blogModal.post?.slug || ''} onChange={(v) => setBlogModal(m => ({ ...m, post: { ...m.post, slug: v } }))} placeholder={tWs('ws.placeholderBlogSlug')} hint={tWs('ws.hintSlug')} />
                <div>
                  <label className="label">{tWs('ws.contentEn')}</label>
                  <textarea name="content" className="input" rows={6} defaultValue={blogModal.post?.content || ''}
                    placeholder={tWs('ws.placeholderBlogContentEn')} style={{ resize: 'vertical' }} />
                </div>
                <div>
                  <label className="label">{tWs('ws.contentBn')}</label>
                  <textarea name="content_bn" className="input" rows={4} defaultValue={blogModal.post?.content_bn || ''}
                    placeholder={tWs('ws.placeholderBlogContentBn')} style={{ resize: 'vertical' }} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">{tWs('ws.excerpt')}</label>
                    <textarea name="excerpt" className="input" rows={2} defaultValue={blogModal.post?.excerpt || ''}
                      placeholder={tWs('ws.placeholderExcerpt')} style={{ resize: 'vertical' }} />
                  </div>
                  <Field label={tWs('ws.authorName')} value={blogModal.post?.author_name || ''} onChange={(v) => setBlogModal(m => ({ ...m, post: { ...m.post, author_name: v } }))} placeholder={tWs('ws.placeholderAuthor')} />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" name="is_published" defaultChecked={!!blogModal.post?.is_published}
                    className="w-4 h-4 rounded border-[var(--color-border)]" />
                  <span className="text-sm font-medium">{tWs('ws.publishImmediately')}</span>
                </label>
                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
                  <button type="button" onClick={() => setBlogModal({ open: false, post: null })} className="btn-secondary text-sm">{tWs('ws.cancel')}</button>
                  <button type="submit" className="btn-primary text-sm"><Save className="w-4 h-4" /> {tWs('ws.savePost')}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    ),

    reviews: (
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-xs text-blue-800 dark:text-blue-200">
          {tWs('ws.reviewsInfo')}
        </div>

        {reviews.length > 0 ? (
          <div className="space-y-2">
            {reviews.map(review => (
              <div key={review.id} className="p-3 rounded-lg bg-[var(--color-border-light)]">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{review.patient_name}</span>
                    <div className="flex gap-0.5">
                      {[1,2,3,4,5].map(i => (
                        <span key={i} className={`text-xs ${i <= review.rating ? 'text-yellow-500' : 'text-gray-300'}`}>&#9733;</span>
                      ))}
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      review.is_approved ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                    }`}>
                      {review.is_approved ? tWs('ws.approved') : tWs('ws.pending')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={async () => {
                      try {
                        await api.put(`/api/website/reviews/${review.id}/approve`,
                          { is_approved: review.is_approved ? 0 : 1 });
                        toast.success(review.is_approved ? tWs('ws.reviewHidden') : tWs('ws.reviewApproved'));
                        invalidateAll();
                      } catch { toast.error(tWs('ws.updateFailed')); }
                    }} className={`p-1.5 rounded-lg transition-colors ${
                      review.is_approved ? 'text-orange-500 hover:bg-orange-50' : 'text-green-600 hover:bg-green-50'
                    }`}>
                      <Check className="w-4 h-4" />
                    </button>
                    <button onClick={async () => {
                      if (!confirm(tWs('ws.confirmDeleteReview'))) return;
                      try {
                        await api.delete(`/api/website/reviews/${review.id}`);
                        toast.success(tWs('ws.reviewDeleted'));
                        invalidateAll();
                      } catch { toast.error(tWs('ws.deleteFailed')); }
                    }} className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {review.review_text && (
                  <p className="text-sm text-[var(--color-text-secondary)] italic">"{review.review_text}"</p>
                )}
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {formatDisplayDate(review.created_at)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-[var(--color-text-muted)]">
            <Star className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{tWs('ws.noReviewsYet')}</p>
            <p className="text-xs mt-1">{tWs('ws.noReviewsHint')}</p>
          </div>
        )}
      </div>
    ),

    departments: (
      <div className="space-y-4">
        {/* Existing Departments */}
        {departments.length > 0 ? (
          <div className="space-y-2">
            {departments.map(dept => (
              <div key={dept.id} className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-border-light)]">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{dept.icon}</span>
                  <div>
                    <p className="text-sm font-medium">{dept.name}</p>
                    {dept.name_bn && <p className="text-xs text-[var(--color-text-muted)]">{dept.name_bn}</p>}
                    <p className="text-[10px] text-[var(--color-text-muted)] font-mono">/{dept.slug}</p>
                  </div>
                </div>
                <button onClick={async () => {
                  if (!confirm(tWs('ws.confirmDeleteDept'))) return;
                  try {
                    await api.delete(`/api/website/departments/${dept.id}`);
                    toast.success(tWs('ws.deptDeleted'));
                    invalidateAll();
                  } catch { toast.error(tWs('ws.deleteFailed')); }
                }} className="text-red-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-[var(--color-text-muted)]">
            <Building2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">{tWs('ws.noDeptsYet')}</p>
          </div>
        )}

        {/* Add New Department */}
        <div className="p-4 rounded-xl border border-dashed border-[var(--color-border)] space-y-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{tWs('ws.addNewDept')}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name (English)" value={newDept.name} onChange={v => setNewDept(d => ({ ...d, name: v }))} placeholder={tWs('ws.placeholderDeptNameEn')} />
            <Field label="Name (Bengali)" value={newDept.name_bn} onChange={v => setNewDept(d => ({ ...d, name_bn: v }))} placeholder={tWs('ws.placeholderDeptNameBn')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="URL Slug" value={newDept.slug} onChange={v => setNewDept(d => ({ ...d, slug: v }))} placeholder={tWs('ws.placeholderDeptSlug')} hint={tWs('ws.hintSlug')} />
            <div>
              <label className="label">{tWs('ws.iconEmoji')}</label>
              <input className="input" value={newDept.icon} onChange={e => setNewDept(d => ({ ...d, icon: e.target.value }))} placeholder={tWs('ws.placeholderDeptIcon')} />
            </div>
          </div>
          <Field label="Description" value={newDept.description} onChange={v => setNewDept(d => ({ ...d, description: v }))}
            placeholder={tWs('ws.placeholderDeptDesc')} rows={2} />
          <div className="flex justify-end">
            <button onClick={async () => {
              if (!newDept.name.trim() || !newDept.slug.trim()) { toast.error(tWs('ws.deptNameSlugRequired')); return; }
              try {
                await api.post('/api/website/departments', newDept);
                toast.success(tWs('ws.deptAdded'));
                setNewDept({ name: '', name_bn: '', slug: '', description: '', description_bn: '', icon: '\u{1F3E5}', is_active: 1, sort_order: 0 });
                invalidateAll();
              } catch { toast.error(tWs('ws.deptAddFailed')); }
            }} className="btn-primary text-sm">
              <Plus className="w-4 h-4" /> {tWs('ws.addDepartment')}
            </button>
          </div>
        </div>
      </div>
    ),

    seo: (
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 text-xs text-yellow-800 dark:text-yellow-200">
          {tWs('ws.seoTips')}
        </div>

        <Field label="SEO Title" value={config.seo_title || ''} onChange={sc('seo_title')}
          placeholder={tWs('ws.placeholderSeoTitle')}
          hint={`${(config.seo_title || '').length}/120 characters`} />

        <Field label="Meta Description" value={config.seo_description || ''} onChange={sc('seo_description')} rows={2}
          placeholder={tWs('ws.placeholderSeoDesc')}
          hint={`${(config.seo_description || '').length}/300 characters`} />

        <Field label="Keywords" value={config.seo_keywords || ''} onChange={sc('seo_keywords')}
          placeholder={tWs('ws.placeholderSeoKeywords')}
          hint={tWs('ws.hintKeywords')} />

        {/* Preview */}
        <div className="p-4 rounded-xl bg-[var(--color-border-light)]">
          <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-2 uppercase tracking-wide">{tWs('ws.googlePreview')}</p>
          <div className="space-y-0.5">
            <p className="text-blue-600 text-base font-medium">{config.seo_title || tWs('ws.yourHospitalName')}</p>
            <p className="text-green-700 text-xs">yourhospital.hms.ozzyl.com/site</p>
            <p className="text-sm text-[var(--color-text-muted)]">{config.seo_description || tWs('ws.seoPreviewDesc')}</p>
          </div>
        </div>
      </div>
    ),

    appearance: (
      <div className="space-y-4">
        {/* Theme Selector */}
        <div>
          <label className="label">{tWs('ws.theme')}</label>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {THEMES.map(theme => (
              <button key={theme.id} onClick={() => setConfig(c => ({ ...c, theme: theme.id }))}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  config.theme === theme.id
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] shadow-md'
                    : 'border-[var(--color-border)] hover:border-[var(--color-primary)] hover:bg-[var(--color-border-light)]'
                }`}>
                <div className="w-8 h-8 rounded-full mb-2" style={{ background: theme.color }} />
                <p className="text-sm font-semibold">{theme.name}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{theme.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Custom Colors */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">{tWs('ws.primaryColor')}</label>
            <div className="flex items-center gap-3 mt-1">
              <input type="color" value={config.primary_color || '#0891b2'}
                onChange={e => setConfig(c => ({ ...c, primary_color: e.target.value }))}
                className="w-10 h-10 rounded-lg border border-[var(--color-border)] cursor-pointer" />
              <input className="input flex-1" value={config.primary_color || ''} onChange={e => sc('primary_color')(e.target.value)}
                placeholder={tWs('ws.placeholderColor')} />
            </div>
          </div>
          <div>
            <label className="label">{tWs('ws.secondaryColor')}</label>
            <div className="flex items-center gap-3 mt-1">
              <input type="color" value={config.secondary_color || '#059669'}
                onChange={e => setConfig(c => ({ ...c, secondary_color: e.target.value }))}
                className="w-10 h-10 rounded-lg border border-[var(--color-border)] cursor-pointer" />
              <input className="input flex-1" value={config.secondary_color || ''} onChange={e => sc('secondary_color')(e.target.value)}
                placeholder={tWs('ws.placeholderColor')} />
            </div>
          </div>
        </div>
      </div>
    ),
  };

  return (
    <DashboardLayout role={role}>
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">{tWs('ws.hospitalWebsite')}</h1>
            <p className="section-subtitle mt-1">{tWs('ws.manageWebsite')}</p>
          </div>
          <button onClick={handleTriggerRender} disabled={rendering}
            className="btn-secondary text-xs flex items-center gap-1.5">
            <RefreshCw className={`w-3.5 h-3.5 ${rendering ? 'animate-spin' : ''}`} />
            {rendering ? tWs('ws.rendering') : tWs('ws.rerender')}
          </button>
        </div>

        <div className="flex flex-col md:flex-row gap-5">
          {/* Sidebar Tabs */}
          <div className="md:w-44 shrink-0">
            <div className="card p-2 flex md:flex-col gap-0.5 overflow-x-auto">
              {TABS.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left whitespace-nowrap
                    ${activeTab === tab.id
                      ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]'
                      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]'
                    }`}>
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content Panel */}
          <div className="flex-1">
            <div className="card p-5 space-y-5">
              <h2 className="section-title border-b border-[var(--color-border)] pb-3">
                {TABS.find(t => t.id === activeTab)?.label}
              </h2>
              {loading ? (
                <div className="space-y-3">
                  {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-10 w-full rounded-lg" />)}
                </div>
              ) : (
                tabContent[activeTab]
              )}
              {!['services', 'gallery', 'blog', 'reviews', 'departments'].includes(activeTab) && (
                <div className="pt-2 border-t border-[var(--color-border)]">
                  <button onClick={handleSaveConfig} disabled={saving} className="btn-primary">
                    <Save className="w-4 h-4" /> {saving ? tWs('ws.saving') : tWs('ws.saveChanges')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}

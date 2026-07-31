import { useState, useRef } from 'react';
import { Upload, X, Camera, RefreshCw } from 'lucide-react';
import { compressImage } from '../../lib/compressImage';
import { api } from '../../lib/apiClient';
import toast from 'react-hot-toast';

interface Props {
  photoKey: string;
  onUpload: (key: string) => void;
  onDelete: () => void;
}

export function DoctorPhotoUploader({ photoKey, onUpload, onDelete }: Props) {
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derive URL from key
  const photoUrl = photoKey 
    ? (photoKey.startsWith('http') ? photoKey : `/api/doctors/photo/${encodeURIComponent(photoKey)}`)
    : null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size before processing (5MB raw limit)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Original file too large. Max 10MB.');
      return;
    }

    setIsUploading(true);
    try {
      // 1. Convert to WebP (Lossless-ish high quality 0.9)
      // Resize to 600px for profile photos
      const compressedBlob = await compressImage(file, 600, 0.9);
      const webpFile = new File([compressedBlob], 'doctor-photo.webp', { type: 'image/webp' });

      // 2. Upload to R2 via our new backend route
      const formData = new FormData();
      formData.append('photo', webpFile);

      const response = await api.post<{ photoKey: string }>('/api/doctors/upload-photo', formData);
      
      onUpload(response.photoKey);
      toast.success('Photo uploaded successfully');
    } catch (error) {
      console.error('Upload failed:', error);
      toast.error('Failed to upload photo');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-5">
        <div className="relative group shrink-0">
          <div className="w-28 h-28 rounded-3xl border-2 border-dashed border-[var(--color-border)] bg-[var(--color-bg-alt)] overflow-hidden flex items-center justify-center transition-all group-hover:border-[var(--color-primary)] shadow-inner">
            {photoUrl ? (
              <img src={photoUrl} alt="Doctor" className="w-full h-full object-cover" />
            ) : (
              <div className="text-center p-2">
                <Camera className="w-8 h-8 text-[var(--color-text-muted)] mx-auto mb-1 group-hover:text-[var(--color-primary)] transition-colors" />
                <span className="text-[10px] text-[var(--color-text-muted)] font-medium">No Photo</span>
              </div>
            )}
            
            {isUploading && (
              <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2">
                <RefreshCw className="w-6 h-6 text-white animate-spin" />
                <span className="text-[10px] text-white font-bold uppercase tracking-wider">Uploading</span>
              </div>
            )}
          </div>
          
          {photoKey && !isUploading && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-xl shadow-lg hover:bg-red-600 transition-transform hover:scale-110 active:scale-95"
              title="Remove photo"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1 space-y-2.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-full h-11 bg-white border border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] text-[var(--color-text-primary)] font-semibold rounded-xl flex items-center justify-center gap-2.5 text-sm transition-all shadow-sm active:scale-[0.98]"
          >
            <Upload className="w-4 h-4" />
            {photoKey ? 'Update Photo' : 'Upload Doctor Photo'}
          </button>
          <div className="bg-[var(--color-bg-alt)] p-2.5 rounded-lg border border-[var(--color-border)]">
            <p className="text-[10px] text-[var(--color-text-muted)] leading-relaxed">
              <strong className="text-[var(--color-text-secondary)]">Note:</strong> Images are optimized to WebP format. Maximum file size is 5MB. Square images work best.
            </p>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}

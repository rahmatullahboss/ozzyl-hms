import React, { useState, useRef } from 'react';
import { Camera, Upload, X, Loader2, TestTube, FileText, Pill, FilePlus } from 'lucide-react';
import toast from 'react-hot-toast';

interface DocumentScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

export function DocumentScanner({ isOpen, onClose, onUploaded }: DocumentScannerProps) {
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [autoTags, setAutoTags] = useState<string[]>([]);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError('Document must be < 10MB');
      return;
    }

    setImage(file);
    setPreview(URL.createObjectURL(file));
    setError(null);
    setAutoTags([]);
    setUploadSuccess(false);
  };

  const handleCapture = () => {
    fileInputRef.current?.click();
  };

  const getTagIcon = (tag: string) => {
    switch(tag) {
      case 'prescription': return <Pill className="w-4 h-4" />;
      case 'lab_report': return <TestTube className="w-4 h-4" />;
      case 'discharge_summary': return <FileText className="w-4 h-4" />;
      default: return <FilePlus className="w-4 h-4" />;
    }
  };

  const formatTagLabel = (tag: string) => {
    return tag.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  const uploadAndClassify = async () => {
    if (!image) return;

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', image);
      formData.append('title', image.name.replace(/\.[^/.]+$/, ''));
      formData.append('document_type', 'scan');

      const response = await fetch('/api/patient-phr/vault/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');
      const data = await response.json().catch(() => ({}));

      // Auto-tag based on simple filename heuristics
      const filename = image.name.toLowerCase();
      const tags: string[] = [];
      if (filename.includes('prescription') || filename.includes('rx')) tags.push('prescription');
      else if (filename.includes('lab') || filename.includes('test') || filename.includes('blood')) tags.push('lab_report');
      else if (filename.includes('discharge') || filename.includes('summary')) tags.push('discharge_summary');
      else tags.push('scan');

      setAutoTags(tags);
      setUploadSuccess(true);
      toast.success('Document scanned and uploaded to vault');

      setTimeout(() => {
        onUploaded();
        onClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Error uploading document');
      toast.error(err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">Scan Document</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {!preview ? (
          <div className="space-y-4">
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileSelect}
            />
            
            <button 
              onClick={handleCapture}
              className="w-full flex flex-col items-center justify-center gap-3 p-8 bg-blue-50 text-blue-700 rounded-xl hover:bg-blue-100 transition-colors border-2 border-dashed border-blue-300"
            >
              <div className="p-4 bg-blue-100 rounded-full">
                <Camera className="w-8 h-8 text-blue-600" />
              </div>
              <div className="text-center">
                <span className="font-bold text-lg block">Scan New Page</span>
                <span className="text-sm font-medium opacity-80">Prescriptions, Labs, Summaries</span>
              </div>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative aspect-[3/4] w-full max-w-sm mx-auto overflow-hidden rounded-xl border border-gray-200">
              <img 
                src={preview} 
                alt="Document preview" 
                className="w-full h-full object-cover"
              />
              {isUploading && (
                <div className="absolute inset-0 bg-white/70 flex flex-col items-center justify-center backdrop-blur-sm">
                  <Loader2 className="w-10 h-10 animate-spin text-blue-600 mb-4" />
                  <p className="font-bold text-gray-800">Uploading & Analyzing...</p>
                  <p className="text-sm text-gray-500 mt-1">Extracting auto-tags</p>
                </div>
              )}
            </div>
            
            {uploadSuccess && autoTags.length > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex flex-col items-center justify-center animate-in fade-in slide-in-from-bottom-2">
                <div className="w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-2">
                  <Upload className="w-5 h-5" />
                </div>
                <p className="font-bold text-gray-900 mb-2">Document Categorized!</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {autoTags.map(tag => (
                    <div key={tag} className="flex items-center gap-1.5 px-3 py-1 bg-white border border-green-200 text-green-700 text-sm font-semibold rounded-full shadow-sm">
                      {getTagIcon(tag)}
                      {formatTagLabel(tag)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!uploadSuccess && (
              <div className="flex gap-2">
                <button 
                  onClick={() => { setPreview(null); setImage(null); }}
                  className="flex-1 py-3 font-medium text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 disabled:opacity-50"
                  disabled={isUploading}
                >
                  Retake
                </button>
                <button 
                  onClick={uploadAndClassify}
                  className="flex-[2] flex items-center justify-center gap-2 py-3 font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 shadow-md shadow-blue-600/20 disabled:opacity-50 disabled:shadow-none"
                  disabled={isUploading}
                >
                  Confirm & Upload
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, X, Loader2, Check } from 'lucide-react';
import { CameraFoodItem, useIdentifyFood } from '../../hooks/useFoodLog';

interface IdentifiedItem extends CameraFoodItem {
  food_item_id?: number | null;
  db_match?: { id: number; name_bn: string; name_en: string } | null;
}

interface FoodCameraCaptureProps {
  onFoodIdentified?: (items: IdentifiedItem[]) => void;
  onClose?: () => void;
}

export default function FoodCameraCapture({ onFoodIdentified, onClose }: FoodCameraCaptureProps) {
  const { i18n } = useTranslation('patientPortal');
  const isBn = i18n.language === 'bn';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [results, setResults] = useState<IdentifiedItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const { mutateAsync: identifyFood, isPending: identifying } = useIdentifyFood();

  const handleCapture = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);

    setError(null);
    setResults([]);

    try {
      const data = await identifyFood(file);
      setResults(data.items || []);
      if (!data.items || data.items.length === 0) {
        setError(isBn ? 'খাবার চিনতে পারিনি। আবার চেষ্টা করুন।' : 'Could not identify food. Try again.');
      }
    } catch (error: any) {
      setError(error.message || (isBn ? 'নেটওয়ার্ক সমস্যা' : 'Network error'));
    }
  }, [isBn, identifyFood]);

  const handleSelectItem = useCallback((item: IdentifiedItem) => {
    onFoodIdentified?.([item]);
  }, [onFoodIdentified]);

  const handleSelectAll = useCallback(() => {
    if (results.length > 0) {
      onFoodIdentified?.(results);
    }
  }, [results, onFoodIdentified]);

  return (
    <div className="space-y-4">
      {/* Hidden file input for camera */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Camera button or preview */}
      {!preview ? (
        <button
          onClick={handleCapture}
          className="w-full py-8 border-2 border-dashed border-emerald-300 rounded-2xl flex flex-col items-center gap-3 hover:bg-emerald-50 transition-colors"
        >
          <Camera className="w-10 h-10 text-emerald-500" />
          <span className="text-sm font-medium text-emerald-700">
            {isBn ? 'খাবারের ছবি তুলুন' : 'Take a Photo of Your Food'}
          </span>
        </button>
      ) : (
        <div className="relative">
          <img src={preview} alt="Food" className="w-full h-48 object-cover rounded-xl" />
          <button
            onClick={() => { setPreview(null); setResults([]); setError(null); }}
            className="absolute top-2 right-2 p-1.5 bg-black/50 rounded-full"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>
      )}

      {/* Loading state */}
      {identifying && (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
          <span className="text-sm text-slate-500">{isBn ? 'খাবার চিনছি...' : 'Identifying food...'}</span>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-center text-sm text-red-500 py-2">{error}</p>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500">
            {isBn ? `${results.length}টি খাবার পাওয়া গেছে:` : `Found ${results.length} item(s):`}
          </p>
          {results.map((item, i) => (
            <button
              key={i}
              onClick={() => handleSelectItem(item)}
              className="w-full text-left p-3 bg-emerald-50 rounded-xl hover:bg-emerald-100 transition-colors flex justify-between items-center"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {isBn ? item.name_bn : item.name_en}
                  {item.db_match && <Check className="w-3.5 h-3.5 text-emerald-500 inline ml-1" />}
                </p>
                <p className="text-xs text-slate-500">{item.serving_description}</p>
              </div>
              <span className="text-xs font-semibold text-emerald-600">{item.estimated_calories} kcal</span>
            </button>
          ))}

          {results.length > 1 && (
            <button
              onClick={handleSelectAll}
              className="w-full py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-xl hover:bg-emerald-500 transition-colors"
            >
              {isBn ? 'সব যোগ করুন' : 'Add All Items'}
            </button>
          )}
        </div>
      )}

      {onClose && (
        <button onClick={onClose} className="w-full py-2 text-sm text-slate-500 hover:text-slate-700">
          {isBn ? 'বাতিল' : 'Cancel'}
        </button>
      )}
    </div>
  );
}

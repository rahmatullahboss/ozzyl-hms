import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { X, Search, Plus, Minus, Camera, ArrowLeft } from 'lucide-react';
import FoodCameraCapture from './FoodCameraCapture';
import { FoodItem, CameraFoodItem, useSearchFood, useBarcodeLookup, useLogFood, useFoodCategories } from '../../hooks/useFoodLog';



interface FoodLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogged?: () => void;
}

const MEAL_TYPES = ['breakfast', 'lunch', 'snacks', 'dinner'] as const;
const MEAL_LABELS_BN: Record<string, string> = {
  breakfast: 'সকালের নাস্তা',
  lunch: 'দুপুরের খাবার',
  snacks: 'বিকেলের নাস্তা',
  dinner: 'রাতের খাবার',
};

export default function FoodLogModal({ isOpen, onClose, onLogged }: FoodLogModalProps) {
  const { t, i18n } = useTranslation('patientPortal');
  const isBn = i18n.language === 'bn';

  const [mealType, setMealType] = useState<typeof MEAL_TYPES[number]>('lunch');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [cameraSelection, setCameraSelection] = useState<CameraFoodItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [showCameraCapture, setShowCameraCapture] = useState(false);
  const [barcode, setBarcode] = useState('');
  const [barcodeMessage, setBarcodeMessage] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const { data: searchData, isFetching: searching } = useSearchFood(debouncedQuery || selectedCategory || ''); // Re-use search endpoint but pass '?category=' if needed? Wait, the API supports '?category=' parameter.
  // Actually, we pass category as search param.
  const { data: searchResults, isFetching: searchingFoods } = useQuery<{ items: FoodItem[] }>({
    queryKey: ['food-search', { q: debouncedQuery, category: selectedCategory }],
    queryFn: async () => {
      let url = '/api/food/search?limit=30';
      if (debouncedQuery) url += `&q=${encodeURIComponent(debouncedQuery)}`;
      if (selectedCategory) url += `&category=${encodeURIComponent(selectedCategory)}`;
      
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Search failed');
      return res.json();
    },
    enabled: !!debouncedQuery || !!selectedCategory,
  });

  const results = searchResults?.items || [];
  const { data: categoriesData, isLoading: loadingCategories } = useFoodCategories();
  const categories = categoriesData?.categories || [];

  const { mutateAsync: lookupBarcode } = useBarcodeLookup();
  const { mutateAsync: logFood, isPending: submitting } = useLogFood();

  const handleSelect = useCallback((item: FoodItem) => {
    setSelected(item);
    setCameraSelection(null);
    setQuantity(1);
  }, []);

  const handleCameraSelect = useCallback((items: CameraFoodItem[]) => {
    const [first] = items;
    if (!first) return;

    setSelected(null);
    setCameraSelection(first);
    setQuantity(1);
    setShowCameraCapture(false);
  }, []);

  const handleBarcodeLookup = useCallback(async () => {
    if (!barcode.trim()) return;
    setBarcodeMessage('');
    try {
      const data = await lookupBarcode(barcode.trim());
      const item = (data as { item?: FoodItem }).item;
      if (item) {
        setSelected(item);
        setCameraSelection(null);
        setQuantity(1);
      } else {
        setBarcodeMessage('No item found for this barcode.');
      }
    } catch (e: any) {
      setBarcodeMessage(e.message || 'Barcode lookup failed.');
    }
  }, [barcode, lookupBarcode]);

  const handleSubmit = useCallback(async () => {
    if (!selected && !cameraSelection) return;
    try {
      const multiplier = selected
        ? (quantity * selected.serving_size_g) / 100
        : quantity;
      
      await logFood({
        meal_type: mealType,
        food_item_id: selected?.id,
        custom_name: cameraSelection ? `${cameraSelection.name_en} / ${cameraSelection.name_bn}` : undefined,
        calories: selected
          ? selected.calories_per_100g * multiplier
          : cameraSelection!.estimated_calories * multiplier,
        protein_g: selected
          ? selected.protein_g * multiplier
          : cameraSelection!.protein_g * multiplier,
        carbs_g: selected
          ? selected.carbs_g * multiplier
          : cameraSelection!.carbs_g * multiplier,
        fat_g: selected
          ? selected.fat_g * multiplier
          : cameraSelection!.fat_g * multiplier,
        quantity,
        unit: 'serving',
      });
      onLogged?.();
      onClose();
      setSelected(null);
      setCameraSelection(null);
      setQuery('');
      setShowCameraCapture(false);
    } catch { /* ignore */ }
  }, [selected, cameraSelection, quantity, mealType, onClose, onLogged, logFood]);

  if (!isOpen) return null;

  const estimatedCal = selected
    ? Math.round(selected.calories_per_100g * (quantity * selected.serving_size_g) / 100)
    : cameraSelection
      ? Math.round(cameraSelection.estimated_calories * quantity)
      : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-md rounded-t-3xl max-h-[85vh] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-lg font-bold text-slate-900">{t('quickActions.logFood')}</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="px-5 pb-3">
          <button
            onClick={() => {
              setShowCameraCapture((value) => !value);
              setSelected(null);
              setCameraSelection(null);
              setSelectedCategory(null);
            }}
            className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
              showCameraCapture
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-emerald-200 hover:bg-emerald-50/60'
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Camera className="w-4 h-4" />
              {isBn ? 'খাবারের ছবি তুলুন' : 'Take a Photo of Your Food'}
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              {isBn ? 'ছবি থেকে খাবার চিনে ক্যালোরি যোগ করুন' : 'Identify food from a photo and add the nutrition automatically'}
            </span>
          </button>
        </div>

        <div className="px-5 pb-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                placeholder={isBn ? 'বারকোড নম্বর লিখুন' : 'Enter barcode number'}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-200"
              />
              <button
                onClick={() => void handleBarcodeLookup()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                {isBn ? 'খুঁজুন' : 'Lookup'}
              </button>
            </div>
            {barcodeMessage && <p className="mt-2 text-xs font-medium text-amber-700">{barcodeMessage}</p>}
          </div>
        </div>

        {/* Meal type tabs */}
        <div className="flex gap-2 px-5 pb-3">
          {MEAL_TYPES.map((mt) => (
            <button
              key={mt}
              onClick={() => setMealType(mt)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                mealType === mt
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {isBn ? MEAL_LABELS_BN[mt] : mt.charAt(0).toUpperCase() + mt.slice(1)}
            </button>
          ))}
        </div>

        {/* Search */}
        {!selectedCategory && (
          <div className="px-5 pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
                placeholder={isBn ? 'খাবার খুঁজুন...' : 'Search food...'}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-shadow"
              />
            </div>
          </div>
        )}

        {/* Selected Category Header */}
        {selectedCategory && (
          <div className="px-5 pb-3 flex items-center gap-3">
            <button
              onClick={() => setSelectedCategory(null)}
              className="p-2 rounded-full bg-slate-100 hover:bg-slate-200 transition-colors"
            >
              <ArrowLeft className="w-4 h-4 text-slate-600" />
            </button>
            <h3 className="font-bold text-slate-800">
              {categories.find(c => c.key === selectedCategory)?.[isBn ? 'name_bn' : 'name_en']}
            </h3>
          </div>
        )}

        {/* Results or Selected */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {showCameraCapture ? (
            <FoodCameraCapture onFoodIdentified={handleCameraSelect} onClose={() => setShowCameraCapture(false)} />
          ) : (selected || cameraSelection) ? (
            <div className="space-y-4">
              <div className="bg-emerald-50 p-4 rounded-xl">
                <p className="font-semibold text-emerald-900">
                  {selected
                    ? (isBn ? selected.name_bn : selected.name_en)
                    : (isBn ? cameraSelection?.name_bn : cameraSelection?.name_en)}
                </p>
                <p className="text-xs text-emerald-700 mt-1">
                  {selected
                    ? `${selected.serving_description || `${selected.serving_size_g}g`} = ${selected.calories_per_100g * selected.serving_size_g / 100} kcal`
                    : `${cameraSelection?.serving_description || '1 serving'} = ${cameraSelection?.estimated_calories ?? 0} kcal`}
                </p>
              </div>

              {/* Quantity */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">{isBn ? 'পরিমাণ' : 'Quantity'}</span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setQuantity(Math.max(0.5, quantity - 0.5))}
                    className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-lg font-bold w-8 text-center">{quantity}</span>
                  <button
                    onClick={() => setQuantity(Math.min(10, quantity + 0.5))}
                    className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Estimated nutrition */}
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="bg-orange-50 p-2 rounded-lg">
                  <p className="font-bold text-orange-700">{estimatedCal}</p>
                  <p className="text-orange-500">kcal</p>
                </div>
                <div className="bg-blue-50 p-2 rounded-lg">
                  <p className="font-bold text-blue-700">{Math.round((selected ? selected.protein_g * quantity * selected.serving_size_g / 100 : (cameraSelection?.protein_g ?? 0) * quantity))}g</p>
                  <p className="text-blue-500">{isBn ? 'প্রোটিন' : 'Protein'}</p>
                </div>
                <div className="bg-yellow-50 p-2 rounded-lg">
                  <p className="font-bold text-yellow-700">{Math.round((selected ? selected.carbs_g * quantity * selected.serving_size_g / 100 : (cameraSelection?.carbs_g ?? 0) * quantity))}g</p>
                  <p className="text-yellow-500">{isBn ? 'কার্বস' : 'Carbs'}</p>
                </div>
                <div className="bg-red-50 p-2 rounded-lg">
                  <p className="font-bold text-red-700">{Math.round((selected ? selected.fat_g * quantity * selected.serving_size_g / 100 : (cameraSelection?.fat_g ?? 0) * quantity))}g</p>
                  <p className="text-red-500">{isBn ? 'ফ্যাট' : 'Fat'}</p>
                </div>
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold transition-colors disabled:opacity-60"
              >
                {submitting ? '...' : isBn ? 'লগ করুন' : 'Log Food'}
              </button>
            </div>
          ) : (
            <div className="space-y-1">
              {/* Category Browser (Show only if no query, no selected category, and no items selected) */}
              {!query && !selectedCategory && !searchingFoods && results.length === 0 && (
                <div className="pb-4">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">{isBn ? 'ক্যাটাগরি' : 'Categories'}</h3>
                  {loadingCategories ? (
                    <div className="flex flex-wrap gap-2 animate-pulse">
                      {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="h-10 w-24 bg-slate-100 rounded-xl" />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {categories.map((cat) => (
                        <button
                          key={cat.key}
                          onClick={() => setSelectedCategory(cat.key)}
                          className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-sm font-medium text-slate-700 transition-colors border border-transparent hover:border-emerald-200"
                        >
                          {isBn ? cat.name_bn : cat.name_en}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {searchingFoods && <p className="text-center text-xs text-slate-400 py-4">{isBn ? 'খুঁজছি...' : 'Searching...'}</p>}
              
              {!searchingFoods && (query || selectedCategory) && results.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-slate-500 text-sm mb-1">{isBn ? 'কিছু পাওয়া যায়নি' : 'No results found'}</p>
                  <p className="text-slate-400 text-xs">Try searching with a different name</p>
                </div>
              )}
              {results.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className="w-full text-left p-3 rounded-xl hover:bg-slate-50 transition-colors flex justify-between items-center"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">{isBn ? item.name_bn : item.name_en}</p>
                    <p className="text-xs text-slate-500">{isBn ? item.name_en : item.name_bn}</p>
                  </div>
                  <span className="text-xs text-emerald-600 font-semibold">
                    {Math.round(item.calories_per_100g * item.serving_size_g / 100)} kcal
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { Camera, Search, X, Loader2, CheckCircle2, AlertCircle, Sparkles, ScanLine } from 'lucide-react';
import { useBarcodeLookup, useLogFood, FoodItem } from '../../hooks/useFoodLog';

interface BarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onLogged: () => void;
}

export function BarcodeScanner({ isOpen, onClose, onLogged }: BarcodeScannerProps) {
  const [isScanning, setIsScanning] = useState(false);
  const [scannedCode, setScannedCode] = useState<string | null>(null);
  const [foodData, setFoodData] = useState<FoodItem & { macros?: { protein: number, carbohydrates: number, fat: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { mutateAsync: lookupBarcode, isPending: isLookingUp } = useBarcodeLookup();
  const { mutateAsync: logFood, isPending: isLogging } = useLogFood();

  if (!isOpen) return null;

  const simulateScan = () => {
    setIsScanning(true);
    setError(null);
    setFoodData(null);
    setScannedCode(null);

    // Simulate taking 2 seconds to focus and scan
    setTimeout(() => {
      setIsScanning(false);
      // Example valid EAN-13 from our database (e.g. Pran Mango Juice)
      const mockEan13 = '8941113200155';
      setScannedCode(mockEan13);
      performLookup(mockEan13);
    }, 2000);
  };

  const performLookup = async (code: string) => {
    setError(null);
    try {
      const data = await lookupBarcode(code);
      if (data && data.item) {
        // Map the backend structure to what the UI is expecting
        setFoodData({
          ...data.item,
          macros: {
            protein: data.item.protein_g,
            carbohydrates: data.item.carbs_g,
            fat: data.item.fat_g,
          }
        });
      } else {
        throw new Error('Product not found in database');
      }
    } catch (err: any) {
      setError(err.message || 'Product not found in database');
    }
  };

  const handleManualSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const code = formData.get('barcode') as string;
    
    if (code && code.trim().length > 0) {
      setScannedCode(code);
      performLookup(code);
    }
  };

  const handleSave = async () => {
    if (!foodData) return;
    try {
      await logFood({
        meal_type: 'snacks', // Default to snacks for quick scans, or could let user change
        food_item_id: foodData.id,
        calories: foodData.calories_per_100g, // Assuming 1 serving
        protein_g: foodData.protein_g,
        carbs_g: foodData.carbs_g,
        fat_g: foodData.fat_g,
        quantity: 1,
        unit: 'serving',
      });
      onLogged();
      onClose();
    } catch (err) {
      setError('Failed to log food entry.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm font-sans animate-in fade-in duration-300">
      <div className="w-full max-w-md bg-white rounded-[2rem] shadow-[0_20px_60px_rgb(0,0,0,0.1)] overflow-hidden relative pb-6 animate-in slide-in-from-bottom-8">
        {/* Soft decorative background */}
        <div className="absolute top-0 right-0 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl" />

        {/* Header */}
        <div className="flex justify-between items-center p-6 relative z-10">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-500" />
            <h2 className="text-xl font-bold text-slate-800 font-['Manrope'] tracking-tight">NourishAI Log</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 relative z-10">
          {error && (
            <div className="mb-6 p-4 bg-rose-50 text-rose-800 rounded-2xl text-sm flex items-start gap-3 shadow-sm border border-rose-100">
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-500" />
              <p className="font-['Be_Vietnam_Pro'] font-medium pt-0.5">{error}</p>
            </div>
          )}

          {!foodData && !isLookingUp ? (
            <div className="space-y-6">
              {/* Scanner View */}
              <div className="bg-slate-900 rounded-3xl overflow-hidden aspect-[4/3] relative flex items-center justify-center shadow-inner">
                {/* Simulated Camera Feed view */}
                <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1606913084603-3e7702b01627?q=80&w=2000&auto=format&fit=crop')] bg-cover opacity-20 sepia-[.3]" />
                
                {isScanning ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 backdrop-blur-sm bg-slate-900/60 z-20">
                    <ScanLine className="w-12 h-12 text-emerald-400 animate-pulse mb-2" />
                    <div className="w-full max-w-[200px] h-0.5 bg-emerald-500 absolute top-1/2 animate-ping shadow-[0_0_15px_rgba(16,185,129,1)]" />
                    <p className="text-sm font-bold text-emerald-400 font-['Manrope'] tracking-widest uppercase">Scanning...</p>
                  </div>
                ) : (
                  <button 
                    onClick={simulateScan}
                    className="flex flex-col items-center gap-3 text-white/80 hover:text-white hover:scale-105 transition-all z-20"
                  >
                    <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur flex items-center justify-center border border-white/20">
                      <Camera className="w-8 h-8" />
                    </div>
                    <span className="font-bold text-sm tracking-wide font-['Manrope']">TAP TO SCAN</span>
                  </button>
                )}
                
                {/* Elegant Corner markers */}
                <div className="absolute top-6 left-6 w-8 h-8 border-t-2 border-l-2 border-white/50 rounded-tl-xl z-10" />
                <div className="absolute top-6 right-6 w-8 h-8 border-t-2 border-r-2 border-white/50 rounded-tr-xl z-10" />
                <div className="absolute bottom-6 left-6 w-8 h-8 border-b-2 border-l-2 border-white/50 rounded-bl-xl z-10" />
                <div className="absolute bottom-6 right-6 w-8 h-8 border-b-2 border-r-2 border-white/50 rounded-br-xl z-10" />
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-100"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-widest font-bold text-slate-400">
                  <span className="px-4 bg-white font-['Manrope']">Or Enter Code</span>
                </div>
              </div>

              <form onSubmit={handleManualSearch} className="flex gap-3">
                <input 
                  type="text" 
                  name="barcode"
                  placeholder="e.g. 8941113200155" 
                  className="flex-1 px-5 py-4 border-0 bg-slate-50 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none font-['Be_Vietnam_Pro'] shadow-inner"
                />
                <button 
                  type="submit"
                  className="px-6 py-4 bg-slate-900 text-white rounded-2xl hover:bg-slate-800 transition-colors shadow-md"
                >
                  <Search className="w-5 h-5" />
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-6">
              {isLookingUp ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                  <Loader2 className="w-10 h-10 animate-spin text-emerald-500 mb-6" />
                  <p className="font-['Manrope'] font-bold text-lg text-slate-700">Identifying via AI...</p>
                  <p className="text-sm">Mapping {scannedCode}</p>
                </div>
              ) : foodData ? (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                  {/* Results Card */}
                  <div className="bg-slate-50 rounded-3xl p-6 shadow-inner relative overflow-hidden mb-6">
                    <div className="absolute -top-10 -right-10 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl" />
                    
                    <div className="flex items-start justify-between mb-6 relative z-10">
                      <div>
                        <p className="text-xs font-bold text-emerald-600 uppercase tracking-widest mb-1.5 font-['Manrope']">
                          {foodData.category || 'Generic'}
                        </p>
                        <h3 className="text-2xl font-black text-slate-800 leading-tight font-['Manrope'] tracking-tight">
                          {foodData.name_en || foodData.name_bn}
                        </h3>
                      </div>
                    </div>

                    <div className="flex items-center justify-between py-4 border-y border-slate-200/60 mb-6 relative z-10">
                      <span className="text-sm font-semibold text-slate-500 font-['Be_Vietnam_Pro']">Per {foodData.serving_description || 'Serving'}</span>
                      <div className="text-right flex items-baseline gap-1">
                        <span className="text-4xl font-black text-emerald-600 font-['Manrope'] tracking-tighter">{foodData.calories_per_100g}</span>
                        <span className="text-sm font-bold text-emerald-600/70">kcal</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 relative z-10">
                      <div className="bg-white p-4 rounded-2xl text-center shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Protein</p>
                        <p className="font-black text-lg text-slate-800 font-['Manrope']">{parseFloat(foodData.protein_g.toString())}g</p>
                      </div>
                      <div className="bg-white p-4 rounded-2xl text-center shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Carbs</p>
                        <p className="font-black text-lg text-slate-800 font-['Manrope']">{parseFloat(foodData.carbs_g.toString())}g</p>
                      </div>
                      <div className="bg-white p-4 rounded-2xl text-center shadow-[0_4px_20px_rgb(0,0,0,0.03)]">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Fat</p>
                        <p className="font-black text-lg text-slate-800 font-['Manrope']">{parseFloat(foodData.fat_g.toString())}g</p>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                    <button 
                      onClick={() => { setFoodData(null); setScannedCode(null); }}
                      className="flex-1 py-4 text-slate-600 bg-slate-100 rounded-2xl hover:bg-slate-200 font-bold transition-colors font-['Manrope']"
                    >
                      Rescan
                    </button>
                    <button 
                      onClick={handleSave}
                      disabled={isLogging}
                      className="flex-[2] flex items-center justify-center gap-2 py-4 bg-emerald-500 text-white rounded-2xl hover:bg-emerald-600 font-bold shadow-[0_8px_25px_rgb(16,185,129,0.3)] transition-all transform hover:-translate-y-0.5 font-['Manrope'] disabled:opacity-50"
                    >
                      {isLogging ? <Loader2 className="w-5 h-5 animate-spin"/> : <CheckCircle2 className="w-5 h-5" />}
                      {isLogging ? 'Logging...' : 'Add to Log'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

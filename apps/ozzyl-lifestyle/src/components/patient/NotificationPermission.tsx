import { BellRing } from 'lucide-react';

export default function NotificationPermission() {
  return (
    <div className="flex items-center justify-center min-h-screen p-6 bg-surface-container-lowest">
      <div className="w-full max-w-md text-center">
        {/* Abstract 3D/Mesh Graphic Area */}
        <div className="relative w-48 h-48 mx-auto mb-10 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-tr from-emerald-400 to-cyan-400 rounded-full blur-2xl opacity-40 animate-pulse" />
          <div className="relative flex items-center justify-center w-full h-full bg-white rounded-full shadow-xl shadow-emerald-500/10 border border-slate-50">
            <BellRing className="w-16 h-16 text-emerald-500" strokeWidth={1.5} />
            <div className="absolute -top-2 -right-2 w-8 h-8 bg-rose-500 rounded-full border-4 border-white shadow-sm" />
          </div>
        </div>

        <h2 className="text-3xl font-bold font-manrope text-slate-900 mb-4 tracking-tight">
          Stay Connected
        </h2>
        <p className="text-slate-500 font-medium px-4 mb-12">
          Never miss a pill reminder, upcoming appointment, or message from your care team. Enhance your health journey with timely updates.
        </p>

        <div className="space-y-4">
          <button className="w-full py-4 text-white font-bold font-manrope rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-400 shadow-lg shadow-emerald-500/25 hover:scale-[0.98] transition-all">
            Enable Notifications
          </button>
          
          <button className="w-full py-4 text-slate-500 font-bold font-manrope rounded-2xl hover:bg-slate-50 transition-colors">
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  );
}

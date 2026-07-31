import { QrCode, ScanLine, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function VisitPassQR({ patientName = 'Arif Rahman', patientId = 'UHID-839210', onClose }: { patientName?: string; patientId?: string; onClose?: () => void }) {
  const { t } = useTranslation('patientPortal');

  return (
    <div className="fixed inset-0 z-50 flex flex-col pt-16 bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-900">
      {/* Background Decor */}
      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none -mt-20 -mr-20">
        <QrCode className="w-96 h-96" />
      </div>

      <div className="relative z-10 flex items-center justify-between px-6 pb-6">
        <button onClick={onClose} className="p-3 text-white bg-white/10 rounded-full backdrop-blur-md">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm p-8 bg-surface-container-lowest/95 backdrop-blur-3xl rounded-[2.5rem] shadow-2xl flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mb-6 shadow-inner">
            <QrCode className="w-8 h-8" />
          </div>

          <h2 className="text-2xl font-bold font-manrope text-slate-900 mb-1">{patientName}</h2>
          <p className="text-sm font-semibold tracking-wider text-slate-500 mb-8">{patientId}</p>

          <div className="relative p-4 bg-white rounded-3xl shadow-sm border border-slate-100 flex items-center justify-center aspect-square w-56 mb-8 group overflow-hidden">
            {/* Replace with actual QR Code Component */}
            <QrCode className="w-full h-full text-slate-800" />
            
            {/* Scanning animation line */}
            <div className="absolute top-0 left-0 w-full h-[2px] bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.8)] animate-pulse" style={{ animation: 'scan 3s ease-in-out infinite' }} />
          </div>

          <div className="flex items-center gap-3 text-emerald-700 bg-emerald-50 px-5 py-3 rounded-full animate-pulse">
            <ScanLine className="w-5 h-5" />
            <span className="font-bold text-sm font-manrope">Ready to Scan</span>
          </div>
        </div>

        <p className="mt-10 text-white/70 text-sm max-w-xs text-center font-medium font-manrope">
          Present this code at the reception kiosk for touchless check-in.
        </p>
      </div>

      <style>{`
        @keyframes scan {
          0%, 100% { top: 5%; opacity: 0; }
          10% { opacity: 1; }
          50% { top: 95%; opacity: 1; }
          90% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

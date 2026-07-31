import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { useVisitPass, useCreateVisitPass, useRevokeVisitPass } from '../../hooks/useVisitPass';
import { Loader2, QrCode, Clock, RefreshCw, XCircle, FileText, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';

export function PatientVisitPass() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useVisitPass();
  const createMutation = useCreateVisitPass();
  const revokeMutation = useRevokeVisitPass();

  const handleGenerate = () => {
    createMutation.mutate({});
  };

  const handleRevoke = (id: string) => {
    revokeMutation.mutate(id);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-teal-800">
        <Loader2 className="w-8 h-8 animate-spin mb-4" />
        <p className="text-sm font-medium tracking-wide">Loading Visit Pass...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 p-4 rounded-xl flex items-center space-x-3 text-sm">
        <XCircle className="w-5 h-5 flex-shrink-0" />
        <p>Failed to load visit pass. Please try again.</p>
      </div>
    );
  }

  const activePass = data?.active_pass;
  const recentPasses = data?.recent_passes ?? [];

  return (
    <div className="space-y-8 max-w-lg mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 font-display">Visit Pass</h1>
        <p className="text-sm text-gray-500 font-medium tracking-wide">
          Your digital access for upcoming hospital visits.
        </p>
      </div>

      {/* Active Pass Card */}
      {activePass ? (
        <div className="relative group">
          {/* Glassmorphic Container Layer */}
          <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 to-teal-800/10 rounded-[24px] blur-xl transition-all duration-500 group-hover:blur-2xl opacity-70" />
          
          <div className="relative bg-white/80 backdrop-blur-xl border border-white/40 shadow-sm rounded-[24px] overflow-hidden">
            {/* Top Teal Ribbon */}
            <div className="h-2 bg-gradient-to-r from-teal-600 to-teal-800" />
            
            <div className="p-6 flex flex-col items-center">
              
              <div className="w-full flex justify-between items-center mb-6">
                <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-teal-50/50 text-teal-700 text-xs font-semibold tracking-wider">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>ACTIVE PASS</span>
                </span>
                {activePass.expires_at && (
                  <span className="text-xs font-semibold text-gray-400">
                    Expires {format(new Date(activePass.expires_at), 'MMM d, p')}
                  </span>
                )}
              </div>

              {/* QR Code Container */}
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center">
                <QRCodeSVG 
                  value={activePass.qr_payload} 
                  size={200}
                  level="H"
                  includeMargin={false}
                  className="w-full h-auto max-w-[200px]"
                />
              </div>

              {/* Patient Info */}
              <div className="mt-8 text-center space-y-1 w-full">
                <p className="text-lg font-semibold text-gray-900 font-display">
                  {activePass.acting_profile?.name ?? 'Patient'}
                </p>
                <p className="text-sm text-gray-500 font-medium">
                  MRN: <span className="text-gray-700">{activePass.acting_profile?.uhid ?? activePass.pass_code_hint}</span>
                </p>
              </div>

              <div className="mt-8 w-full">
                <button
                  onClick={() => handleRevoke(activePass.id)}
                  disabled={revokeMutation.isPending}
                  className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl text-sm font-semibold tracking-wide text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50"
                >
                  {revokeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                  <span>Revoke Pass</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white/60 backdrop-blur-md border border-gray-100/50 shadow-sm rounded-3xl p-8 text-center flex flex-col items-center">
          <div className="w-16 h-16 bg-teal-50 rounded-2xl flex items-center justify-center mb-4 text-teal-600">
            <QrCode className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Active Pass</h3>
          <p className="text-sm text-gray-500 mb-6 max-w-sm">
            Generate a new digital visit pass for your upcoming appointment or hospital visit.
          </p>
          <button
            onClick={handleGenerate}
            disabled={createMutation.isPending}
            className="flex items-center space-x-2 bg-gradient-to-br from-teal-600 to-teal-800 text-white px-6 py-3 rounded-xl font-semibold hover:shadow-md hover:opacity-95 transition-all active:scale-[0.98] disabled:opacity-70"
          >
            {createMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            <span>Generate Pass</span>
          </button>
        </div>
      )}

      {/* Recent Passes List */}
      {recentPasses.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center space-x-2">
            <Clock className="w-4 h-4 text-gray-400" />
            <span>Pass History</span>
          </h3>
          <div className="space-y-3">
            {recentPasses.map((pass) => (
              <div 
                key={pass.id} 
                className="bg-white/40 backdrop-blur-sm border border-gray-100 p-4 rounded-xl flex items-center justify-between"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center text-gray-400">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 line-clamp-1">
                      {pass.redeemed_hospital ?? pass.pass_code_hint}
                    </p>
                    <p className="text-xs font-medium text-gray-500 mt-0.5">
                      {format(new Date(pass.created_at), 'MMM d, yyyy')}
                    </p>
                  </div>
                </div>
                <div>
                  <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded-md ${
                    pass.status === 'active' ? 'bg-teal-50 text-teal-700' :
                    pass.status === 'redeemed' ? 'bg-blue-50 text-blue-700' :
                    pass.status === 'revoked' ? 'bg-red-50 text-red-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {pass.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

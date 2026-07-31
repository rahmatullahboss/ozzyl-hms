import { FileText, TrendingUp, TrendingDown, Minus, ChevronRight, PlusCircle } from 'lucide-react';
import { useScreeningHistory } from '../../hooks/usePatientWellness';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';

export default function ScreeningHistory() {
  const { data: records, isLoading } = useScreeningHistory();

  const getInterpretationColor = (severity: string) => {
    const s = severity?.toLowerCase() || '';
    if (s.includes('none') || s.includes('minimal')) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (s.includes('mild')) return 'bg-cyan-100 text-cyan-800 border-cyan-200';
    if (s.includes('moderate')) return 'bg-amber-100 text-amber-800 border-amber-200';
    return 'bg-rose-100 text-rose-800 border-rose-200';
  };

  const getScreeningName = (type: string) => {
    if (type === 'phq9') return 'PHQ-9 Depression Screen';
    if (type === 'gad7') return 'GAD-7 Anxiety Screen';
    return type.toUpperCase();
  };

  if (isLoading) {
    return <div className="h-48 flex items-center justify-center text-[#10b981] animate-pulse">Loading screening history...</div>;
  }

  return (
    <div className="w-full space-y-8 font-['Be_Vietnam_Pro'] text-[#191c1e]">
      
      {/* Header Area */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
        <div>
          <h2 className="font-['Manrope'] text-2xl font-light tracking-tight text-[#00201c] mb-1">
            Screening History
          </h2>
          <p className="text-sm font-medium text-[#635c61]">
            Track your mental and physical health assessments over time.
          </p>
        </div>
        <button className="flex items-center gap-2 bg-gradient-to-br from-[#006c49] to-[#10b981] text-white px-5 py-2.5 rounded-xl hover:scale-95 transition-transform shadow-sm font-medium whitespace-nowrap">
          <PlusCircle className="w-4 h-4" />
          Take New Screening
        </button>
      </div>

      {/* List Container */}
      <div className="bg-[#f2f4f6] rounded-[2rem] p-4 lg:p-6 shadow-sm border border-[#eceef0]">
        
        {(!records || records.length === 0) ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-[#10b981] shadow-sm mb-4">
              <FileText className="w-8 h-8" />
            </div>
            <p className="text-[#3c4a42] font-medium mb-1">No past screenings</p>
            <p className="text-sm text-[#6c7a71]">Complete your first assessment to build your health profile.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {records.map((record) => (
              <div
                key={record.id}
                className="group relative flex flex-col sm:flex-row sm:items-center justify-between p-5 bg-white rounded-[1.5rem] shadow-sm border border-[#e0e3e5] hover:border-[#10b981]/30 transition-all z-10"
              >
                {/* Visual Depth Graphic */}
                <div className="absolute inset-0 z-[-1] opacity-0 group-hover:opacity-10 transition-opacity bg-gradient-to-r from-[#6ffbbe] to-[#ffddb8] blur-xl rounded-[1.5rem]"></div>
                
                <div className="flex items-start sm:items-center gap-5 mb-4 sm:mb-0">
                  <div className="flex items-center justify-center w-12 h-12 bg-[#f7f9fb] rounded-2xl shrink-0 group-hover:bg-[#10b981]/10 transition-colors">
                    <FileText className="w-6 h-6 text-[#006c49]" />
                  </div>
                  <div>
                    <h3 className="font-['Manrope'] text-lg font-semibold tracking-tight text-[#191c1e] mb-0.5">
                      {getScreeningName(record.screening_type)}
                    </h3>
                    <time className="text-xs font-semibold uppercase tracking-widest text-[#6c7a71]">
                      {formatPatientDateMonthYear(record.created_at)}
                    </time>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-6 sm:w-1/2 ml-14 sm:ml-0">
                  <div className="flex flex-col items-start sm:items-end gap-1.5">
                    <span className="font-['Manrope'] text-xl font-bold text-[#002113]">
                      Score: {record.total_score}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider border ${getInterpretationColor(
                        record.severity
                      )}`}
                    >
                      {record.severity}
                    </span>
                  </div>
                  
                  <button className="flex items-center justify-center w-10 h-10 rounded-full bg-[#f2f4f6] text-[#3c4a42] hover:bg-[#10b981] hover:text-white transition-colors">
                    <ChevronRight className="w-5 h-5 ml-0.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

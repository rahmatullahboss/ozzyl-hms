import { useState } from 'react';
import { Activity, Droplet, Users, Plus, Check } from 'lucide-react';
import { useChallenges } from '../../hooks/usePatientWellness';

const glassContainer = "bg-[#ffffff] rounded-[2rem] p-6 shadow-[0px_4px_24px_rgba(0,108,73,0.04)] border border-[#eceef0] relative overflow-hidden isolate";

export default function SocialChallenges() {
  const { data: challenges, isLoading } = useChallenges();
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');

  if (isLoading) {
    return (
      <div className="h-48 flex items-center justify-center animate-pulse text-[#10b981]">
        Loading your challenges...
      </div>
    );
  }

  // Filter challenges based on the selected tab
  const displayedChallenges = (challenges || []).filter(c => {
    const isCompleted = (c.current_value || 0) >= (c.target || 10000);
    return activeTab === 'completed' ? isCompleted : !isCompleted;
  });

  return (
    <div className="w-full space-y-8 font-['Be_Vietnam_Pro'] text-[#191c1e] pb-12">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 px-2">
        <div>
          <p className="text-sm font-medium text-[#6c7a71] mb-1">Patient Portal / Health Challenges</p>
          <h1 className="font-['Manrope'] text-3xl font-light tracking-tight text-[#002113]">
            Challenges
          </h1>
        </div>
        <button className="flex items-center gap-2 bg-gradient-to-br from-[#006c49] to-[#10b981] text-white px-6 py-3 rounded-xl shadow-sm hover:scale-[0.98] transition-transform font-semibold whitespace-nowrap">
          <Plus className="w-5 h-5" />
          Start New Challenge
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 px-2">
        <button 
          onClick={() => setActiveTab('active')}
          className={`${activeTab === 'active' ? 'bg-[#10b981]/10 text-[#006c49] font-bold' : 'text-[#6c7a71] hover:bg-[#f2f4f6] font-medium'} px-6 py-2 rounded-full text-sm transition-colors`}
        >
          Active Challenges
        </button>
        <button 
          onClick={() => setActiveTab('completed')}
          className={`${activeTab === 'completed' ? 'bg-[#10b981]/10 text-[#006c49] font-bold' : 'text-[#6c7a71] hover:bg-[#f2f4f6] font-medium'} px-6 py-2 rounded-full text-sm transition-colors`}
        >
          Completed
        </button>
      </div>

      {/* Grid */}
      {displayedChallenges.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {displayedChallenges.map((challenge, idx) => {
            const isActivity = challenge.type === 'steps' || challenge.name.toLowerCase().includes('walk') || challenge.name.toLowerCase().includes('run');
            const Icon = isActivity ? Activity : Droplet;
            
            // Generate ethereal background shape
            const blobColor = isActivity ? 'bg-[#6ffbbe]/30' : 'bg-[#fea619]/20';
            
            // Progress logic
            const current = challenge.current_value || 0;
            const target = challenge.target || 10000;
            const percentage = Math.min(100, Math.round((current / target) * 100));

            return (
              <div key={challenge.id || idx} className={`${glassContainer} flex flex-col group`}>
                {/* Abstract Bloom */}
                <div className={`absolute -top-12 -right-12 w-48 h-48 rounded-full blur-[40px] -z-10 mix-blend-multiply ${blobColor}`}></div>
                
                <div className="flex items-start justify-between mb-6">
                  <div className="w-14 h-14 bg-[#f2f4f6] rounded-[1rem] flex items-center justify-center shadow-sm shrink-0">
                    <Icon className="w-6 h-6 text-[#006c49]" />
                  </div>
                  {challenge.joined_at ? (
                    <span className="px-3 py-1 bg-[#10b981]/15 text-[#006c49] text-xs font-bold uppercase tracking-wider rounded-full">
                      Joined
                    </span>
                  ) : (
                    <span className="px-3 py-1 bg-[#ffddb8]/50 text-[#855300] text-xs font-bold uppercase tracking-wider rounded-full">
                      New
                    </span>
                  )}
                </div>

                <h3 className="font-['Manrope'] text-xl font-bold tracking-tight text-[#002113] mb-2 line-clamp-1">
                  {challenge.name}
                </h3>
                <p className="text-sm text-[#3c4a42] mb-6 line-clamp-2 min-h-[40px]">
                  Goal: {challenge.target} {challenge.type === 'steps' ? 'Steps' : ''} over {challenge.duration_days} days.
                </p>

                <div className="mt-auto space-y-4">
                  {/* Progress Bar Area */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-[#6c7a71] uppercase tracking-wider">
                        Progress
                      </span>
                      <span className="text-sm font-semibold text-[#006c49]">
                        {percentage}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-[#eceef0] rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-[#006c49] to-[#10b981] rounded-full transition-all duration-1000"
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>

                  <button className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#f2f4f6] text-[#191c1e] font-semibold hover:bg-[#e0e3e5] hover:text-[#002113] transition-colors">
                    {percentage >= 100 ? (
                      <>
                        <Check className="w-4 h-4 text-[#10b981]" /> Completed
                      </>
                    ) : (
                      'Log Progress'
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-[#f2f4f6] rounded-[2rem] p-12 text-center shadow-sm">
          <div className="w-20 h-20 bg-white rounded-full flex justify-center items-center mx-auto mb-6 shadow-sm">
            <Users className="w-8 h-8 text-[#006c49]" />
          </div>
          <h3 className="font-['Manrope'] text-2xl font-bold text-[#002113] mb-2">No active challenges</h3>
          <p className="text-[#3c4a42] max-w-md mx-auto mb-8">
            You aren't participating in any challenges right now. Start a new health challenge to stay motivated and track your goals!
          </p>
          <button className="inline-flex items-center gap-2 bg-[#006c49] text-white px-8 py-3.5 rounded-xl font-semibold shadow-md hover:scale-[0.98] transition-transform">
            Browse Community Challenges
          </button>
        </div>
      )}
    </div>
  );
}

import type { PatientAuthTab } from '../../lib/patientAuthUi';

interface PatientAuthTabsProps {
  activeTab: PatientAuthTab;
  onChange: (tab: PatientAuthTab) => void;
  labels: Record<PatientAuthTab, string>;
}

export function PatientAuthTabs({ activeTab, onChange, labels }: PatientAuthTabsProps) {
  return (
    <div className="patient-auth-tabbar">
      {(['login', 'register', 'forgot'] as PatientAuthTab[]).map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`patient-auth-tab ${activeTab === tab ? 'patient-auth-tab-active' : 'patient-auth-tab-idle'}`}
        >
          {labels[tab]}
        </button>
      ))}
    </div>
  );
}

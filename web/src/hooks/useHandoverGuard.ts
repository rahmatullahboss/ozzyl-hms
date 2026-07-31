import { useCallback, useMemo, useState } from 'react';

interface HandoverTaskSummary {
  pendingVitals: number;
  overdueMeds: number;
  criticalPatients: number;
}

function getHandoverKey(): string {
  return `handover_completed_${new Date().toISOString().slice(0, 10)}`;
}

function isHandoverCompletedToday(): boolean {
  try {
    return localStorage.getItem(getHandoverKey()) === 'true';
  } catch {
    return false;
  }
}

export function useHandoverGuard(summary: HandoverTaskSummary) {
  const [completed, setCompleted] = useState(isHandoverCompletedToday);

  const pendingTasks = summary.pendingVitals + summary.overdueMeds + summary.criticalPatients;
  const needsHandover = !completed && pendingTasks > 0;

  const markCompleted = useCallback(() => {
    try {
      localStorage.setItem(getHandoverKey(), 'true');
    } catch {
      // Ignore storage failures
    }
    setCompleted(true);
  }, []);

  return useMemo(
    () => ({ needsHandover, pendingTasks, markCompleted }),
    [needsHandover, pendingTasks, markCompleted],
  );
}

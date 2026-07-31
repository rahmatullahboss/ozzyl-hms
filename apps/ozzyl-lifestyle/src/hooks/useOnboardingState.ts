import { useState, useCallback } from 'react';

export interface OnboardingData {
  language: 'bn' | 'en';
  name: string;
  age: string;
  gender: 'male' | 'female' | 'other' | '';
  height_cm: string;
  weight_kg: string;
  goals: string[];
  skipHospital: boolean;
  permissions: {
    notifications: boolean;
    health: boolean;
    camera: boolean;
    biometric: boolean;
  };
}

const INITIAL_DATA: OnboardingData = {
  language: 'bn',
  name: '',
  age: '',
  gender: '',
  height_cm: '',
  weight_kg: '',
  goals: [],
  skipHospital: false,
  permissions: {
    notifications: true,
    health: true,
    camera: true,
    biometric: true,
  },
};

export function useOnboardingState() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<OnboardingData>(INITIAL_DATA);

  const updateData = useCallback((partial: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...partial }));
  }, []);

  const next = useCallback(() => {
    setStep((s) => Math.min(s + 1, 6));
  }, []);

  const back = useCallback(() => {
    setStep((s) => Math.max(s - 1, 0));
  }, []);

  const toggleGoal = useCallback((goal: string) => {
    setData((prev) => {
      const goals = prev.goals.includes(goal)
        ? prev.goals.filter((g) => g !== goal)
        : prev.goals.length < 3
          ? [...prev.goals, goal]
          : prev.goals;
      return { ...prev, goals };
    });
  }, []);

  return { step, setStep, data, updateData, next, back, toggleGoal };
}

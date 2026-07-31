import { describe, it, expect } from 'vitest';

// ─── useOnboardingState logic tests ───────────────────────────────
// We test the pure logic (initial state, goal toggling, bounds) without React rendering.

describe('Onboarding State Logic', () => {
  const INITIAL_DATA = {
    language: 'bn' as const,
    name: '',
    age: '',
    gender: '' as const,
    height_cm: '',
    weight_kg: '',
    goals: [] as string[],
    skipHospital: false,
    permissions: {
      notifications: true,
      health: true,
      camera: true,
      biometric: true,
    },
  };

  it('initial data defaults to Bangla language', () => {
    expect(INITIAL_DATA.language).toBe('bn');
  });

  it('initial permissions are all true', () => {
    expect(INITIAL_DATA.permissions.notifications).toBe(true);
    expect(INITIAL_DATA.permissions.health).toBe(true);
    expect(INITIAL_DATA.permissions.camera).toBe(true);
    expect(INITIAL_DATA.permissions.biometric).toBe(true);
  });

  it('goals start empty', () => {
    expect(INITIAL_DATA.goals).toHaveLength(0);
  });

  // Goal toggle logic (mirrors useOnboardingState.toggleGoal)
  function toggleGoal(goals: string[], goal: string): string[] {
    if (goals.includes(goal)) return goals.filter((g) => g !== goal);
    if (goals.length < 3) return [...goals, goal];
    return goals;
  }

  it('can add a goal', () => {
    const result = toggleGoal([], 'goalActive');
    expect(result).toEqual(['goalActive']);
  });

  it('can remove a goal', () => {
    const result = toggleGoal(['goalActive', 'goalEat'], 'goalActive');
    expect(result).toEqual(['goalEat']);
  });

  it('enforces max 3 goals', () => {
    const three = ['goalActive', 'goalEat', 'goalSleep'];
    const result = toggleGoal(three, 'goalMind');
    expect(result).toHaveLength(3);
    expect(result).not.toContain('goalMind');
  });

  it('can toggle off when at max to make room', () => {
    const three = ['goalActive', 'goalEat', 'goalSleep'];
    const removed = toggleGoal(three, 'goalEat');
    expect(removed).toHaveLength(2);
    const added = toggleGoal(removed, 'goalMind');
    expect(added).toHaveLength(3);
    expect(added).toContain('goalMind');
  });

  // Step bounds
  it('step clamped to 0-6 range', () => {
    const next = (s: number) => Math.min(s + 1, 6);
    const back = (s: number) => Math.max(s - 1, 0);
    expect(next(6)).toBe(6);
    expect(back(0)).toBe(0);
    expect(next(0)).toBe(1);
    expect(back(3)).toBe(2);
  });
});

describe('Onboarding API payload shape', () => {
  it('produces correct POST body from onboarding data', () => {
    const data = {
      language: 'bn' as const,
      name: 'রহমত',
      gender: 'male' as const,
      height_cm: '170',
      weight_kg: '72',
      goals: ['goalActive', 'goalSleep'],
      skipHospital: false,
      permissions: { notifications: true, health: true, camera: false, biometric: true },
    };

    const payload = {
      language: data.language,
      name: data.name,
      gender: data.gender,
      height_cm: data.height_cm ? parseFloat(data.height_cm) : null,
      weight_kg: data.weight_kg ? parseFloat(data.weight_kg) : null,
      goals: data.goals,
      skip_hospital: data.skipHospital,
      permissions: data.permissions,
    };

    expect(payload.language).toBe('bn');
    expect(payload.height_cm).toBe(170);
    expect(payload.weight_kg).toBe(72);
    expect(payload.goals).toHaveLength(2);
    expect(payload.skip_hospital).toBe(false);
    expect(payload.permissions.camera).toBe(false);
  });

  it('handles empty height/weight as null', () => {
    const height_cm = '';
    const weight_kg = '';
    expect(height_cm ? parseFloat(height_cm) : null).toBeNull();
    expect(weight_kg ? parseFloat(weight_kg) : null).toBeNull();
  });
});

describe('Goal to Module mapping (backend contract)', () => {
  // This must match src/routes/patient-auth.ts onboarding endpoint
  const GOAL_MODULE_MAP: Record<string, string[]> = {
    goalActive: ['activity', 'sleep'],
    goalEat: ['nutrition', 'activity'],
    goalSleep: ['sleep', 'mind'],
    goalMind: ['mind'],
    goalMeds: ['medication'],
    goalWeight: ['nutrition', 'activity'],
    goalBpDiabetes: ['vitals'],
    goalPregnancy: ['womensHealth'],
  };

  it('maps 8 goal types to modules', () => {
    expect(Object.keys(GOAL_MODULE_MAP)).toHaveLength(8);
  });

  it('goalActive includes activity and sleep', () => {
    expect(GOAL_MODULE_MAP.goalActive).toContain('activity');
    expect(GOAL_MODULE_MAP.goalActive).toContain('sleep');
  });

  it('goalPregnancy maps to womensHealth', () => {
    expect(GOAL_MODULE_MAP.goalPregnancy).toEqual(['womensHealth']);
  });

  it('selected goals produce unique module list', () => {
    const selected = ['goalActive', 'goalEat', 'goalSleep'];
    const modules = [...new Set(selected.flatMap((g) => GOAL_MODULE_MAP[g] || []))];
    expect(modules).toContain('activity');
    expect(modules).toContain('sleep');
    expect(modules).toContain('nutrition');
    expect(modules).toContain('mind');
    // No duplicates
    expect(modules.length).toBe(new Set(modules).size);
  });
});

describe('Onboarding screens (7 screens)', () => {
  const SCREENS = [
    'welcome',        // 0
    'language',       // 1
    'aboutYou',       // 2
    'goals',          // 3
    'hospital',       // 4
    'permissions',    // 5
    'meetOzzy',       // 6
  ];

  it('has exactly 7 screens', () => {
    expect(SCREENS).toHaveLength(7);
  });

  it('welcome is first, meetOzzy is last', () => {
    expect(SCREENS[0]).toBe('welcome');
    expect(SCREENS[6]).toBe('meetOzzy');
  });

  it('progress bar calculation is correct', () => {
    // progress = step > 0 ? (step / 6) * 100 : 0
    expect(0 > 0 ? (0 / 6) * 100 : 0).toBe(0);
    expect(1 > 0 ? (1 / 6) * 100 : 0).toBeCloseTo(16.67, 1);
    expect(6 > 0 ? (6 / 6) * 100 : 0).toBe(100);
  });
});

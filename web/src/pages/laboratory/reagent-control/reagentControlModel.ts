export type ReagentControlSection = 'overview' | 'stock' | 'recipes' | 'issues';

export type ReagentControlPolicy = {
  lab_inventory_mode: 'disabled' | 'soft' | 'strict' | string;
  reagent_consumption_timing: 'billing' | 'result' | string;
  allow_result_without_stock: boolean;
  require_test_mapping_for_completion: boolean;
};

export type ReagentPolicySummary = {
  tone: 'safe' | 'strict' | 'off';
  title: string;
  description: string;
  timing: string;
  blocking: string;
  recipes: string;
};

export type ReagentControlAction = {
  id: 'enable-safe-control' | 'fix-recipes' | 'review-stock' | 'review-issues';
  section: ReagentControlSection;
  label: string;
  description: string;
};

export const REAGENT_CONTROL_PRIMARY_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'stock', label: 'Stock' },
  { id: 'recipes', label: 'Test Recipes' },
  { id: 'issues', label: 'Issues' },
] as const satisfies ReadonlyArray<{ id: ReagentControlSection; label: string }>;

export function initialReagentControlSection(): ReagentControlSection {
  return 'overview';
}

export function reagentPolicySummary(policy: ReagentControlPolicy): ReagentPolicySummary {
  const timing = policy.reagent_consumption_timing === 'result'
    ? 'When result is completed'
    : 'When billed';

  if (policy.lab_inventory_mode === 'disabled') {
    return {
      tone: 'off',
      title: 'Reagent control is off',
      description: 'Lab work continues, but HMS is not attempting reagent stock deduction for tests.',
      timing,
      blocking: 'No reagent stock is deducted',
      recipes: 'Test recipes are not enforced',
    };
  }

  if (policy.lab_inventory_mode === 'strict') {
    return {
      tone: 'strict',
      title: 'Strict stock control is active',
      description: 'HMS enforces the configured reagent recipe and usable stock checks before completion.',
      timing,
      blocking: 'Unsafe stock cases can stop completion',
      recipes: policy.require_test_mapping_for_completion
        ? 'Test recipes are required'
        : 'Missing recipes may still continue',
    };
  }

  return {
    tone: 'safe',
    title: 'Safe rollout is active',
    description: policy.reagent_consumption_timing === 'result'
      ? 'Reagent deduction is attempted when a lab result is completed. Missing stock or recipes create warnings instead of stopping service.'
      : 'Reagent deduction is attempted when a lab test is billed. Missing stock or recipes create warnings instead of stopping service.',
    timing,
    blocking: policy.allow_result_without_stock
      ? 'Billing and results continue'
      : 'Result completion can be blocked',
    recipes: policy.require_test_mapping_for_completion
      ? 'Test recipes are required'
      : 'Missing recipes create warnings',
  };
}

export function reagentControlNextActions(input: {
  inventoryMode: string;
  missingRecipes: number;
  lowStockCount: number;
  expiringCount: number;
  openIssues: number;
  reconciliationIssues: number;
}): ReagentControlAction[] {
  const actions: ReagentControlAction[] = [];

  if (input.inventoryMode === 'disabled') {
    actions.push({
      id: 'enable-safe-control',
      section: 'overview',
      label: 'Start safe reagent control',
      description: 'Turn on soft mode so HMS can record deductions and warnings without stopping service.',
    });
  }

  if (input.missingRecipes > 0) {
    actions.push({
      id: 'fix-recipes',
      section: 'recipes',
      label: `Set up ${input.missingRecipes} missing test ${input.missingRecipes === 1 ? 'recipe' : 'recipes'}`,
      description: 'Choose which reagent or consumable each test uses and how much.',
    });
  }

  const stockAttention = input.lowStockCount + input.expiringCount;
  if (stockAttention > 0) {
    actions.push({
      id: 'review-stock',
      section: 'stock',
      label: `Review ${stockAttention} stock ${stockAttention === 1 ? 'warning' : 'warnings'}`,
      description: 'Add stock or review low, expiring, blocked or QC-failed lots.',
    });
  }

  const issueCount = input.openIssues + input.reconciliationIssues;
  if (issueCount > 0) {
    actions.push({
      id: 'review-issues',
      section: 'issues',
      label: `Review ${issueCount} reagent ${issueCount === 1 ? 'issue' : 'issues'}`,
      description: 'Fix the cause, then retry or close the affected deduction.',
    });
  }

  return actions.slice(0, 3);
}

export function reagentControlQueryState(
  section: ReagentControlSection,
  options: { advancedOpen?: boolean } = {},
) {
  return {
    loadRecipes: section === 'recipes',
    loadStockDetails: section === 'stock',
    loadReconciliation: section === 'issues',
    loadLogs: Boolean(options.advancedOpen),
    loadReadinessDetails: Boolean(options.advancedOpen),
  };
}

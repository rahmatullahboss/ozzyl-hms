import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReagentControlAdvancedPanel from './ReagentControlAdvancedPanel';

const policy = {
  lab_inventory_mode: 'soft' as const,
  reagent_consumption_timing: 'billing' as const,
  allow_result_without_stock: true,
  require_test_mapping_for_completion: false,
};

const summary = {
  tone: 'safe' as const,
  title: 'Safe rollout is active',
  description: 'Warnings do not stop service.',
  timing: 'When billed',
  blocking: 'Billing and results continue',
  recipes: 'Missing recipes create warnings',
};

describe('ReagentControlAdvancedPanel', () => {
  it('shows a readable summary while dangerous controls stay collapsed', () => {
    render(
      <ReagentControlAdvancedPanel
        policy={policy}
        policySummary={summary}
        strictReady={false}
        readinessMessage="2 tests still need recipes"
        readinessChecks={[]}
        logs={[]}
        onPolicyChange={() => undefined}
        onApplySafePolicy={() => undefined}
        onEnableStrict={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Advanced reagent settings' })).toBeInTheDocument();
    expect(screen.getByText('Safe rollout is active')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reagent control mode')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable strict stock control' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Operation logs' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('No operation logs for the selected date.')).not.toBeInTheDocument();
  });

  it('reveals policy controls and keeps strict activation blocked until ready', () => {
    const onPolicyChange = vi.fn();
    render(
      <ReagentControlAdvancedPanel
        policy={policy}
        policySummary={summary}
        strictReady={false}
        strictAvailable
        readinessMessage="2 tests still need recipes"
        readinessChecks={[{ id: 'recipes', label: 'Test recipes', ready: false, detail: '2 missing' }]}
        logs={[]}
        onPolicyChange={onPolicyChange}
        onApplySafePolicy={() => undefined}
        onEnableStrict={() => undefined}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Automation policy controls' }));
    expect(screen.getByLabelText('Reagent control mode')).toBeInTheDocument();
    expect(screen.getByLabelText('Deduct stock')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enable strict stock control' })).toBeDisabled();
    expect(screen.getByText('2 tests still need recipes')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Deduct stock'), { target: { value: 'result' } });
    expect(onPolicyChange).toHaveBeenCalledWith({ reagent_consumption_timing: 'result' });
  });

  it('reveals logs separately and invokes safe/strict actions', () => {
    const onApplySafePolicy = vi.fn();
    const onEnableStrict = vi.fn();
    render(
      <ReagentControlAdvancedPanel
        policy={policy}
        policySummary={summary}
        strictReady
        strictAvailable
        readinessMessage={null}
        readinessChecks={[{ id: 'recipes', label: 'Test recipes', ready: true, detail: 'Complete' }]}
        logs={[{ id: 1, log_type: 'reagent_usage', quantity: 1, description: 'CBC reagent deducted', created_at: '2026-07-10 09:00' }]}
        onPolicyChange={() => undefined}
        onApplySafePolicy={onApplySafePolicy}
        onEnableStrict={onEnableStrict}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Automation policy controls' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply safe rollout policy' }));
    expect(onApplySafePolicy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Enable strict stock control' }));
    expect(onEnableStrict).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Operation logs' }));
    expect(screen.getByText('CBC reagent deducted')).toBeInTheDocument();
  });

  it('keeps catalog, lab monitoring and machine tools reachable', () => {
    const onOpenCatalog = vi.fn();
    render(
      <ReagentControlAdvancedPanel
        policy={policy}
        policySummary={summary}
        strictReady={false}
        readinessMessage="Not ready"
        readinessChecks={[]}
        logs={[]}
        onPolicyChange={() => undefined}
        onApplySafePolicy={() => undefined}
        onEnableStrict={() => undefined}
        onOpenCatalog={onOpenCatalog}
        labMonitoringHref="/h/demo/lab/monitoring"
        machineSettingsHref="/h/demo/lab-machines"
        integrationSummary={{ title: 'Analyzer setup needs attention', detail: '2 unmatched results are waiting.' }}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Manage reagent catalog' }));
    expect(onOpenCatalog).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Open full lab monitoring' })).toHaveAttribute('href', '/h/demo/lab/monitoring');
    expect(screen.getByRole('link', { name: 'Open machine settings' })).toHaveAttribute('href', '/h/demo/lab-machines');
    expect(screen.getByText('Analyzer setup needs attention')).toBeInTheDocument();
  });

  it('syncs legacy reagent stock to canonical inventory from advanced tools', () => {
    const onSyncLegacyStock = vi.fn();
    render(
      <ReagentControlAdvancedPanel
        policy={policy}
        policySummary={summary}
        strictReady={false}
        readinessMessage="Not ready"
        readinessChecks={[]}
        logs={[]}
        onPolicyChange={() => undefined}
        onApplySafePolicy={() => undefined}
        onEnableStrict={() => undefined}
        onSyncLegacyStock={onSyncLegacyStock}
        syncLegacyStockPending={false}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sync legacy stock to Inventory' }));
    expect(onSyncLegacyStock).toHaveBeenCalledTimes(1);
  });

  it('closes through its explicit close action', () => {
    const onClose = vi.fn();
    render(
      <ReagentControlAdvancedPanel
        policy={policy}
        policySummary={summary}
        strictReady={false}
        readinessMessage="Not ready"
        readinessChecks={[]}
        logs={[]}
        onPolicyChange={() => undefined}
        onApplySafePolicy={() => undefined}
        onEnableStrict={() => undefined}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close advanced settings' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

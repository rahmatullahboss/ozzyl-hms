import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import UnifiedFilterBar, { FilterState } from '../UnifiedFilterBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => opts?.defaultValue ?? k,
    i18n: { language: 'en' },
  }),
}));

const defaultFilters: FilterState = {
  dateRange: null,
  preset: null,
  providerId: null,
  encounterType: null,
  eventType: null,
};

const providers = [
  { id: 1, name: 'Dr. Ahmed' },
  { id: 2, name: 'Dr. Khan' },
];

describe('UnifiedFilterBar', () => {
  let onFilterChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onFilterChange = vi.fn();
  });

  it('renders the filter bar container', () => {
    render(<UnifiedFilterBar filters={defaultFilters} onFilterChange={onFilterChange} />);
    expect(screen.getByTestId('unified-filter-bar')).toBeInTheDocument();
  });

  it('renders date preset buttons', () => {
    render(<UnifiedFilterBar filters={defaultFilters} onFilterChange={onFilterChange} />);
    expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /7d/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /30d/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /6m/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1y/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /custom/i })).toBeInTheDocument();
  });

  it('calls onFilterChange with preset when preset button clicked', async () => {
    const user = userEvent.setup();
    render(<UnifiedFilterBar filters={defaultFilters} onFilterChange={onFilterChange} />);
    await user.click(screen.getByRole('button', { name: /today/i }));
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ preset: 'today' }),
    );
  });

  it('highlights active preset button', () => {
    const filters = { ...defaultFilters, preset: '30d' as const };
    const { container } = render(<UnifiedFilterBar filters={filters} onFilterChange={onFilterChange} />);
    const presetBtns = container.querySelectorAll('button');
    const btn30d = Array.from(presetBtns).find(b => b.textContent?.trim() === '30D');
    expect(btn30d).toBeDefined();
    expect(btn30d!.className).toMatch(/active/);
  });

  it('renders provider dropdown when providers prop given', () => {
    render(
      <UnifiedFilterBar
        filters={defaultFilters}
        onFilterChange={onFilterChange}
        providers={providers}
      />,
    );
    expect(screen.getByRole('combobox', { name: /provider/i })).toBeInTheDocument();
  });

  it('does not render provider dropdown when providers is empty', () => {
    render(
      <UnifiedFilterBar
        filters={defaultFilters}
        onFilterChange={onFilterChange}
        providers={[]}
      />,
    );
    expect(screen.queryByRole('combobox', { name: /provider/i })).not.toBeInTheDocument();
  });

  it('calls onFilterChange with providerId when provider selected', async () => {
    const user = userEvent.setup();
    render(
      <UnifiedFilterBar
        filters={defaultFilters}
        onFilterChange={onFilterChange}
        providers={providers}
      />,
    );
    const select = screen.getByRole('combobox', { name: /provider/i });
    await user.selectOptions(select, '1');
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 1 }),
    );
  });

  it('renders encounter type dropdown when showEncounterType is true', () => {
    render(
      <UnifiedFilterBar
        filters={defaultFilters}
        onFilterChange={onFilterChange}
        showEncounterType
      />,
    );
    expect(screen.getByRole('combobox', { name: /encounter type/i })).toBeInTheDocument();
  });

  it('does not render encounter type dropdown by default', () => {
    render(<UnifiedFilterBar filters={defaultFilters} onFilterChange={onFilterChange} />);
    expect(screen.queryByRole('combobox', { name: /encounter type/i })).not.toBeInTheDocument();
  });

  it('renders event type pills when showEventType is true', () => {
    render(
      <UnifiedFilterBar
        filters={defaultFilters}
        onFilterChange={onFilterChange}
        showEventType
      />,
    );
    expect(screen.getByRole('button', { name: /visits/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /prescriptions/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /labs/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /admissions/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /documents/i })).toBeInTheDocument();
  });

  it('does not render event type pills by default', () => {
    render(<UnifiedFilterBar filters={defaultFilters} onFilterChange={onFilterChange} />);
    expect(screen.queryByRole('button', { name: /visits/i })).not.toBeInTheDocument();
  });

  it('calls onFilterChange with eventType when event pill clicked', async () => {
    const user = userEvent.setup();
    render(
      <UnifiedFilterBar
        filters={defaultFilters}
        onFilterChange={onFilterChange}
        showEventType
      />,
    );
    await user.click(screen.getByRole('button', { name: /labs/i }));
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'labs' }),
    );
  });

  it('shows active filter chips for each active filter', () => {
    const filters: FilterState = {
      dateRange: null,
      preset: '30d',
      providerId: 1,
      encounterType: 'OPD',
      eventType: 'labs',
    };
    render(
      <UnifiedFilterBar
        filters={filters}
        onFilterChange={onFilterChange}
        providers={providers}
        showEncounterType
        showEventType
      />,
    );
    const chipContainer = screen.getByTestId('active-filters');
    expect(chipContainer).toBeInTheDocument();
    expect(chipContainer.textContent).toMatch(/30D/);
    expect(chipContainer.textContent).toMatch(/Dr\. Ahmed/i);
    expect(chipContainer.textContent).toMatch(/OPD/);
    expect(chipContainer.textContent).toMatch(/Labs/i);
  });

  it('removes individual filter when chip close button clicked', async () => {
    const user = userEvent.setup();
    const filters: FilterState = {
      ...defaultFilters,
      preset: '30d',
      providerId: 1,
    };
    render(
      <UnifiedFilterBar
        filters={filters}
        onFilterChange={onFilterChange}
        providers={providers}
      />,
    );
    const chipCloseButtons = screen.getAllByRole('button', { name: /remove/i });
    await user.click(chipCloseButtons[0]);
    expect(onFilterChange).toHaveBeenCalled();
  });

  it('clears all filters when Clear All clicked', async () => {
    const user = userEvent.setup();
    const filters: FilterState = {
      ...defaultFilters,
      preset: '30d',
      providerId: 1,
      eventType: 'labs',
    };
    render(
      <UnifiedFilterBar
        filters={filters}
        onFilterChange={onFilterChange}
        providers={providers}
        showEventType
      />,
    );
    await user.click(screen.getByRole('button', { name: /clear all/i }));
    expect(onFilterChange).toHaveBeenCalledWith({
      dateRange: null,
      preset: null,
      providerId: null,
      encounterType: null,
      eventType: null,
    });
  });

  it('does not show Clear All when no filters active', () => {
    render(<UnifiedFilterBar filters={defaultFilters} onFilterChange={onFilterChange} />);
    expect(screen.queryByRole('button', { name: /clear all/i })).not.toBeInTheDocument();
  });

  it('renders in compact mode when compact prop is true', () => {
    const { container } = render(
      <UnifiedFilterBar filters={defaultFilters} onFilterChange={onFilterChange} compact />,
    );
    const bar = container.querySelector('[data-testid="unified-filter-bar"]');
    expect(bar?.className).toMatch(/compact/);
  });

  it('toggles custom date range inputs when Custom clicked', async () => {
    const user = userEvent.setup();
    const filters = { ...defaultFilters, preset: 'custom' as const };
    render(<UnifiedFilterBar filters={filters} onFilterChange={onFilterChange} />);
    const bar = screen.getByTestId('unified-filter-bar');
    const dateInputs = bar.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBe(2);
  });

  it('calls onFilterChange with dateRange when custom dates set', async () => {
    const user = userEvent.setup();
    const filters = { ...defaultFilters, preset: 'custom' as const, dateRange: { start: '', end: '' } };
    const { container } = render(<UnifiedFilterBar filters={filters} onFilterChange={onFilterChange} />);
    const dateInputs = container.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(1);
    await user.type(dateInputs[0], '2026-01-01');
    expect(onFilterChange).toHaveBeenCalled();
  });

  it('renders all providers in dropdown', () => {
    render(
      <UnifiedFilterBar
        filters={defaultFilters}
        onFilterChange={onFilterChange}
        providers={providers}
      />,
    );
    const select = screen.getByRole('combobox', { name: /provider/i });
    expect(within(select).getByText('Dr. Ahmed')).toBeInTheDocument();
    expect(within(select).getByText('Dr. Khan')).toBeInTheDocument();
  });

  it('renders encounter type options: OPD, IPD, Emergency, Telehealth, All', () => {
    render(
      <UnifiedFilterBar
        filters={defaultFilters}
        onFilterChange={onFilterChange}
        showEncounterType
      />,
    );
    const select = screen.getByRole('combobox', { name: /encounter type/i });
    expect(within(select).getByText(/opd/i)).toBeInTheDocument();
    expect(within(select).getByText(/ipd/i)).toBeInTheDocument();
    expect(within(select).getByText(/emergency/i)).toBeInTheDocument();
    expect(within(select).getByText(/telehealth/i)).toBeInTheDocument();
  });

  it('deselects preset when same preset clicked again', async () => {
    const user = userEvent.setup();
    const filters = { ...defaultFilters, preset: 'today' as const };
    const { container } = render(<UnifiedFilterBar filters={filters} onFilterChange={onFilterChange} />);
    const presetBtns = container.querySelectorAll('button');
    const todayBtn = Array.from(presetBtns).find(b => b.textContent?.trim() === 'Today');
    expect(todayBtn).toBeDefined();
    await user.click(todayBtn!);
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ preset: null }),
    );
  });

  it('deselects event type when same type clicked again', async () => {
    const user = userEvent.setup();
    const filters = { ...defaultFilters, eventType: 'labs' };
    const { container } = render(
      <UnifiedFilterBar
        filters={filters}
        onFilterChange={onFilterChange}
        showEventType
      />,
    );
    const eventBtns = container.querySelectorAll('button');
    const labsBtn = Array.from(eventBtns).find(b => b.textContent?.trim() === 'Labs');
    expect(labsBtn).toBeDefined();
    await user.click(labsBtn!);
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: null }),
    );
  });
});

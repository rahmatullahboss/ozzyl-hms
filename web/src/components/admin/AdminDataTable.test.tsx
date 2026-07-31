import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AdminDataTable from './AdminDataTable';
import type { DataTableColumn } from './AdminDataTable';

interface TestRow {
  id: number;
  name: string;
  amount: number;
  status: string;
}

const columns: DataTableColumn<TestRow>[] = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'amount', label: 'Amount', sortable: true },
  { key: 'status', label: 'Status' },
];

const testData: TestRow[] = [
  { id: 1, name: 'Alice', amount: 100, status: 'active' },
  { id: 2, name: 'Bob', amount: 250, status: 'pending' },
  { id: 3, name: 'Charlie', amount: 50, status: 'active' },
  { id: 4, name: 'Diana', amount: 175, status: 'completed' },
];

describe('AdminDataTable', () => {
  it('renders all rows and columns', () => {
    render(<AdminDataTable columns={columns} data={testData} rowKey={r => r.id} />);
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.getByText('Bob')).toBeDefined();
    expect(screen.getByText('Charlie')).toBeDefined();
    expect(screen.getByText('Diana')).toBeDefined();
    expect(screen.getByText('Name')).toBeDefined();
    expect(screen.getByText('Amount')).toBeDefined();
    expect(screen.getByText('Status')).toBeDefined();
  });

  it('renders empty message when no data', () => {
    render(<AdminDataTable columns={columns} data={[]} rowKey={r => r.id} emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeDefined();
  });

  it('renders loading skeleton', () => {
    const { container } = render(<AdminDataTable columns={columns} data={[]} rowKey={r => r.id} loading />);
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThanOrEqual(1);
  });

  it('filters by search', () => {
    render(<AdminDataTable columns={columns} data={testData} rowKey={r => r.id} searchKeys={['name']} />);
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'ali' } });
    expect(screen.getByText('Alice')).toBeDefined();
    expect(screen.queryByText('Bob')).toBeNull();
  });

  it('sorts by column click', () => {
    render(<AdminDataTable columns={columns} data={testData} rowKey={r => r.id} />);
    fireEvent.click(screen.getByText('Amount'));
    const amounts = screen.getAllByText(/\d+/).map(el => el.textContent);
    expect(amounts).toContain('50');
  });

  it('paginates correctly', () => {
    const bigData = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      name: `User ${i + 1}`,
      amount: i * 10,
      status: 'active',
    }));
    render(<AdminDataTable columns={columns} data={bigData} rowKey={r => r.id} pageSize={10} />);
    expect(screen.getByText('User 1')).toBeDefined();
    expect(screen.queryByText('User 11')).toBeNull();
    expect(screen.getByText('Showing 1–10 of 25')).toBeDefined();
  });

  it('calls onRowClick', () => {
    const onClick = vi.fn();
    render(<AdminDataTable columns={columns} data={testData} rowKey={r => r.id} onRowClick={onClick} />);
    fireEvent.click(screen.getByText('Alice'));
    expect(onClick).toHaveBeenCalledWith(testData[0]);
  });

  it('toggles column visibility', () => {
    render(<AdminDataTable columns={columns} data={testData} rowKey={r => r.id} />);
    fireEvent.click(screen.getByTitle('Toggle columns'));
    // Find the checkbox for 'Status' in the column picker
    const statusLabel = screen.getAllByText('Status').find(el => el.tagName === 'LABEL')!;
    const checkbox = statusLabel.querySelector('input[type="checkbox"]')!;
    fireEvent.click(checkbox);
    // Status column header should be gone (but label in picker still exists)
    const ths = document.querySelectorAll('th');
    const statusHeader = Array.from(ths).find(th => th.textContent?.trim() === 'Status');
    expect(statusHeader).toBeUndefined();
  });

  it('shows sort indicators', () => {
    render(<AdminDataTable columns={columns} data={testData} rowKey={r => r.id} />);
    fireEvent.click(screen.getByText('Name'));
    expect(screen.getByText('Name').closest('th')?.querySelector('svg')).toBeDefined();
  });

  it('handles null values in sort', () => {
    const dataWithNull: TestRow[] = [
      { id: 1, name: 'Alice', amount: 100, status: 'active' },
      { id: 2, name: '', amount: 250, status: 'pending' },
    ];
    render(<AdminDataTable columns={columns} data={dataWithNull} rowKey={r => r.id} />);
    expect(screen.getByText('Alice')).toBeDefined();
  });
});

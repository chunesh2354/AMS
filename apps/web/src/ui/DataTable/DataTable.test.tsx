import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, RESTRICTED, type Column } from '.';

type R = { id: string; name: string; amount: number | typeof RESTRICTED };
const rows: R[] = [{ id: '1', name: 'Asha', amount: 400000 }, { id: '2', name: 'Vikram', amount: 100 }, { id: '3', name: 'Farah', amount: RESTRICTED }];
const columns: Column<R>[] = [
  { key: 'name', header: 'Name', value: (r) => r.name, sortable: true },
  { key: 'amount', header: 'Amount', type: 'money', value: (r) => r.amount, sortable: true, total: 400100 },
];
const base = { label: 'People', columns, rows, rowKey: (r: R) => r.id };

describe('DataTable', () => {
  it('formats money en-IN, fences restricted values and totals', () => {
    render(<DataTable {...base} />);
    expect(screen.getByText('₹4,00,000')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /restricted/ })).toBeInTheDocument();
    expect(screen.getByText('₹4,00,100')).toBeInTheDocument();
  });
  it('sorts and sets aria-sort', async () => {
    render(<DataTable {...base} />);
    await userEvent.click(screen.getByRole('button', { name: 'Amount' }));
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'ascending');
    const body = screen.getAllByRole('rowgroup')[1];
    expect(within(body).getAllByRole('row')[0]).toHaveTextContent('Vikram');
  });
  it('excludes unselectable rows from select all', async () => {
    const onChange = vi.fn();
    render(<DataTable {...base} selection={{ selected: [], onChange, isSelectable: (r) => r.id !== '2' }} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(onChange).toHaveBeenCalledWith(['1', '3']);
  });
  it.each([
    ['loading', 'Loading'], ['error', /could not be loaded/], ['denied', /permission/], ['empty', 'Nothing to show yet.'],
  ] as const)('renders the %s state', (state, text) => {
    render(<DataTable {...base} state={state} />);
    expect(typeof text === 'string' && state === 'loading' ? screen.getByLabelText(text) : screen.getByText(text)).toBeInTheDocument();
  });
  it('edits inline', async () => {
    const onEdit = vi.fn();
    render(<DataTable {...base} columns={[{ ...columns[0], onEdit }]} />);
    await userEvent.click(screen.getAllByRole('button', { name: /^Edit Name/ })[0]);
    await userEvent.keyboard('X{Enter}');
    expect(onEdit).toHaveBeenCalledWith(rows[0], 'AshaX');
  });
});

import { expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AttentionList, sortAttention, type AttentionRow } from '.';

const rows: AttentionRow[] = [
  { id: 'a', status: 'Returned', title: 'Warn old', detail: '', ageDays: 9 },
  { id: 'b', status: 'Overrun', title: 'Danger young', detail: '', ageDays: 2 },
  { id: 'c', status: 'Overdue', title: 'Danger old', detail: '', ageDays: 40, to: '/x' },
];

it('sorts by severity, then age', () => {
  expect(sortAttention(rows).map((r) => r.id)).toEqual(['c', 'b', 'a']);
});
it('links rows that have a target and shows the age in days', () => {
  render(<MemoryRouter><AttentionList items={rows} /></MemoryRouter>);
  const first = screen.getAllByRole('listitem')[0];
  expect(within(first).getByRole('link')).toHaveAttribute('href', '/x');
  expect(first).toHaveTextContent('40 d');
});
it('shows an empty state with no rows', () => {
  render(<MemoryRouter><AttentionList items={[]} emptyMessage="All clear." /></MemoryRouter>);
  expect(screen.getByText('All clear.')).toBeInTheDocument();
});

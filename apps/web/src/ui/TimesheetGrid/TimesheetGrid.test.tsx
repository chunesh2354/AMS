import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimesheetGrid, type TimesheetLine } from '.';

const days = ['Mon', 'Tue', 'Wed'].map((label) => ({ key: label, label, date: '01', scheduled: 8 }));
const lines: TimesheetLine[] = [
  { id: 'a', title: 'Concept design', hours: [4, 0, 0] },
  { id: 'b', title: 'Working drawings', hours: [2, 2, 0], state: 'locked' },
];

it('navigates with arrow keys and edits with Enter', async () => {
  const onChange = vi.fn();
  render(<TimesheetGrid label="Week" days={days} lines={lines} onChange={onChange} />);
  const cells = screen.getAllByRole('gridcell');
  cells[0].focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(document.activeElement).toHaveAttribute('data-cell', 'ts-0-1');
  await userEvent.keyboard('{Enter}');
  await userEvent.keyboard('2.5{Enter}');
  expect(onChange).toHaveBeenCalledWith('a', 1, 2.5);
});

it('starts editing when typing and cancels on Escape', async () => {
  const onChange = vi.fn();
  render(<TimesheetGrid label="Week" days={days} lines={lines} onChange={onChange} />);
  screen.getAllByRole('gridcell')[1].focus();
  await userEvent.keyboard('7');
  expect(screen.getByRole('textbox', { name: 'Hours' })).toHaveValue('7');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('textbox', { name: 'Hours' })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

it('never edits a locked row', async () => {
  const onChange = vi.fn();
  render(<TimesheetGrid label="Week" days={days} lines={lines} onChange={onChange} />);
  const row = screen.getByRole('rowheader', { name: /Locked/ }).closest('tr')!;
  within(row).getAllByRole('gridcell')[0].focus();
  await userEvent.keyboard('{Enter}5');
  expect(screen.queryByRole('textbox', { name: 'Hours' })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});

it('totals rows and columns', () => {
  render(<TimesheetGrid label="Week" days={days} lines={lines} />);
  expect(screen.getByRole('img', { name: /Mon: 6.00 h/ })).toBeInTheDocument();
  expect(screen.getByText('8.00')).toBeInTheDocument();
});

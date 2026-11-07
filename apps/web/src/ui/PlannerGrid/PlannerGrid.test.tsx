import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlannerGrid, type PlannerAllocation } from '.';

const columns = ['A', 'B', 'C'].map((label) => ({ key: label, label }));
const rows = [{ id: 'r1', label: 'Divya Menon' }, { id: 'r2', label: 'Rohan Shetty' }];
const allocations: PlannerAllocation[] = [{ id: 'a', rowId: 'r1', column: 0, hours: 24, label: 'Working drawings', kind: 'confirmed', published: true }];

it('exposes grid roles with row and column headers', () => {
  render(<PlannerGrid label="Plan" columns={columns} rows={rows} allocations={allocations} />);
  expect(screen.getByRole('grid', { name: 'Plan' })).toBeInTheDocument();
  expect(screen.getAllByRole('columnheader')).toHaveLength(4);
  expect(screen.getByRole('rowheader', { name: /Divya Menon/ })).toBeInTheDocument();
  expect(screen.getByText('Published')).toBeInTheDocument();
});

it('moves focus with arrow keys and opens with Enter', async () => {
  const onCardClick = vi.fn();
  const onCellClick = vi.fn();
  render(<PlannerGrid label="Plan" columns={columns} rows={rows} allocations={allocations} onCardClick={onCardClick} onCellClick={onCellClick} />);
  const cells = screen.getAllByRole('gridcell');
  cells[0].focus();
  await userEvent.keyboard('{Enter}');
  expect(onCardClick).toHaveBeenCalledWith(allocations[0]);
  await userEvent.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(cells[1]);
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(cells[4]);
  await userEvent.keyboard('{Enter}');
  expect(onCellClick).toHaveBeenCalledWith('r2', 1);
});

it('moves an allocation with Shift + arrow and resizes with + and -', async () => {
  const onMove = vi.fn();
  const onResize = vi.fn();
  render(<PlannerGrid label="Plan" columns={columns} rows={rows} allocations={allocations} onMove={onMove} onResize={onResize} />);
  screen.getAllByRole('gridcell')[0].focus();
  await userEvent.keyboard('+');
  expect(onResize).toHaveBeenCalledWith('a', 25);
  await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
  expect(onMove).toHaveBeenCalledWith('a', 'r1', 1);
});

it('marks conflict cells and hatched leave', () => {
  render(<PlannerGrid label="Plan" columns={columns} rows={rows} allocations={allocations} over={(r, c) => (r === 'r1' && c === 0 ? 2 : 0)} off={[{ rowId: 'r2', column: 2, label: 'Leave' }]} />);
  const cells = screen.getAllByRole('gridcell');
  expect(cells[0]).toHaveClass('plan__c--conflict');
  expect(cells[0]).toHaveTextContent('+2 h');
  expect(cells[5]).toHaveClass('plan__c--off');
  expect(cells[5]).toHaveTextContent('Leave');
});

it('does not move anything when read-only', () => {
  const onMove = vi.fn();
  render(<PlannerGrid readOnly label="Plan" columns={columns} rows={rows} allocations={allocations} onMove={onMove} />);
  const card = screen.getByRole('button', { name: /24 h/ });
  expect(card).toHaveAttribute('draggable', 'false');
  fireEvent.keyDown(screen.getAllByRole('gridcell')[0], { key: 'ArrowRight', shiftKey: true });
  expect(onMove).not.toHaveBeenCalled();
});

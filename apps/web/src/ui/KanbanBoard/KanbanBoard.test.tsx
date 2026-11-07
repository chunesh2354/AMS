import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KanbanBoard } from '.';

const columns = [{ key: 'a', label: 'Ready', items: [{ id: '1', t: 'Door schedule' }] }, { key: 'b', label: 'Done', items: [], emptyText: 'Nothing done.' }];
const setup = (onMove = vi.fn(), onOpen = vi.fn()) => render(<KanbanBoard label="Board" columns={columns} itemKey={(i) => i.id} itemLabel={(i) => i.t} renderCard={(i) => i.t} onMove={onMove} onOpen={onOpen} />);

it('shows counts and an empty column sentence', () => {
  setup();
  expect(screen.getByRole('region', { name: 'Ready, 1' })).toBeInTheDocument();
  expect(screen.getByText('Nothing done.')).toBeInTheDocument();
});
it('opens a card and moves it from the keyboard menu', async () => {
  const onMove = vi.fn(); const onOpen = vi.fn();
  setup(onMove, onOpen);
  await userEvent.click(screen.getByRole('button', { name: 'Door schedule' }));
  expect(onOpen).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Move Door schedule' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Done' }));
  expect(onMove).toHaveBeenCalledWith(columns[0].items[0], 'b');
});

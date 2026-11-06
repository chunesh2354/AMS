import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu } from '.';

it('moves with arrow keys and selects', async () => {
  const onSelect = vi.fn();
  render(<Menu label="Actions" trigger={(p) => <button {...p}>Open</button>} items={[{ label: 'One' }, { label: 'Two', onSelect }]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(onSelect).toHaveBeenCalled();
});

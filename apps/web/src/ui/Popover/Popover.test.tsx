import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover } from '.';

it('opens, then closes on Escape and returns focus', async () => {
  render(<Popover label="Details" trigger={(p) => <button {...p}>Open</button>}>Body</Popover>);
  await userEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('dialog', { name: 'Details' })).toHaveTextContent('Body');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button')).toHaveFocus();
});

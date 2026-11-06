import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '.';

it('blocks clicks while loading', async () => {
  const onClick = vi.fn();
  render(<Button loading onClick={onClick}>Save</Button>);
  const b = screen.getByRole('button');
  expect(b).toHaveAttribute('aria-busy', 'true');
  await userEvent.click(b);
  expect(onClick).not.toHaveBeenCalled();
});

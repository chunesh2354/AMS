import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from '.';

it('shows on keyboard focus and links aria-describedby', async () => {
  render(<Tooltip text="Hint"><button>Go</button></Tooltip>);
  await userEvent.tab();
  const tip = screen.getByRole('tooltip');
  expect(tip).toHaveTextContent('Hint');
  expect(screen.getByRole('button')).toHaveAttribute('aria-describedby', tip.id);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('tooltip')).toBeNull();
});

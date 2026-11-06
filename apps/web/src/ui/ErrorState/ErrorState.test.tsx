import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorState } from '.';

it('offers retry', async () => {
  const onRetry = vi.fn();
  render(<ErrorState message="Failed" onRetry={onRetry} />);
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalled();
});

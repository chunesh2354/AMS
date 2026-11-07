import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskRow } from '.';

it('shows the task and opens it', async () => {
  const onOpen = vi.fn();
  render(<ul><TaskRow title="Area statement" where="PRJ-02" due="2026-11-08" priority="Low" status="Ready" reviewer="Meera Iyer" onOpen={onOpen} /></ul>);
  expect(screen.getByRole('img', { name: 'Low priority' })).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Ready' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Area statement/ }));
  expect(onOpen).toHaveBeenCalled();
});

import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueueCard } from '.';

it('is a button when clickable', async () => {
  const onClick = vi.fn();
  render(<QueueCard count={14} label="Pending approvals" onClick={onClick} />);
  await userEvent.click(screen.getByRole('button', { name: /14\s*Pending approvals/ }));
  expect(onClick).toHaveBeenCalled();
});
it('hides the count when restricted', () => {
  render(<QueueCard count={1} label="Overdue invoices" restricted />);
  expect(screen.queryByText('1')).toBeNull();
  expect(screen.getByRole('img', { name: /restricted/ })).toBeInTheDocument();
});

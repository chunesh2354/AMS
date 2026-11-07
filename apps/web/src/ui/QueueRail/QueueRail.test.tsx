import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueueRail } from '.';

it('marks the current queue and changes it', async () => {
  const onChange = vi.fn();
  render(<QueueRail label="Queues" value="a" onChange={onChange} items={[{ key: 'a', label: 'All', count: 14 }, { key: 'b', label: 'Time', count: 6 }]} />);
  expect(screen.getByRole('button', { name: 'All 14' })).toHaveAttribute('aria-current', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Time 6' }));
  expect(onChange).toHaveBeenCalledWith('b');
});

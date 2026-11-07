import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Thread } from '.';

it('validates and sends a reply', async () => {
  const onReply = vi.fn();
  render(<Thread label="Review" messages={[{ id: '1', author: 'Vikram Nair', text: 'Check the landing.', time: '14:30' }]} onReply={onReply} />);
  expect(screen.getByText('Check the landing.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
  expect(screen.getByText('Write a reply first')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('textbox', { name: 'Reply' }), 'Done');
  await userEvent.click(screen.getByRole('button', { name: 'Reply' }));
  expect(onReply).toHaveBeenCalledWith('Done');
});

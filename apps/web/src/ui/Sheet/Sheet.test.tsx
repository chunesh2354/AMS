import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sheet } from '.';

function Harness({ dirty }: { dirty?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Bill" dirty={dirty} footer={<button>Save</button>}><input aria-label="Vendor" /></Sheet>
    </>
  );
}

it('focuses the first field, traps Tab, closes on Escape and restores focus', async () => {
  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'Open' });
  await userEvent.click(opener);
  expect(screen.getByRole('dialog', { name: 'Bill' })).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByLabelText('Vendor')).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(opener).toHaveFocus();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('asks before discarding unsaved changes', async () => {
  render(<Harness dirty />);
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  await userEvent.keyboard('{Escape}');
  expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('does not render while closed', () => {
  render(<Sheet open={false} onClose={vi.fn()} title="Bill">x</Sheet>);
  expect(screen.queryByRole('dialog')).toBeNull();
});

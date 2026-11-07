import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApprovalRow } from '.';

const item = { id: '1', type: 'Time', submitter: 'Arjun Das', project: 'PRJ-01', period: '26 Oct', amount: '40.00 h', ageDays: 5, approver: 'Vikram Nair' };

it('cannot be selected when it is an exception', () => {
  render(<ul><ApprovalRow item={{ ...item, exception: 'Over 12 h day' }} /></ul>);
  expect(screen.getByRole('checkbox')).toBeDisabled();
  expect(screen.getByText('Over 12 h day')).toBeInTheDocument();
});
it('requires a reason to return', async () => {
  const onReturn = vi.fn();
  render(<ul><ApprovalRow item={item} onReturn={onReturn} /></ul>);
  await userEvent.click(screen.getByRole('button', { name: 'Return' }));
  const send = screen.getAllByRole('button', { name: 'Return' }).at(-1)!;
  await userEvent.click(send);
  expect(screen.getByText('A reason is required')).toBeInTheDocument();
  expect(onReturn).not.toHaveBeenCalled();
  await userEvent.type(screen.getByLabelText('Reason for returning'), 'wrong phase');
  await userEvent.click(send);
  expect(onReturn).toHaveBeenCalledWith('wrong phase');
});
it('fires approve and delegate', async () => {
  const onApprove = vi.fn(); const onDelegate = vi.fn();
  render(<ul><ApprovalRow item={item} onApprove={onApprove} onDelegate={onDelegate} /></ul>);
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await userEvent.click(screen.getByRole('button', { name: 'Delegate' }));
  expect(onApprove).toHaveBeenCalled();
  expect(onDelegate).toHaveBeenCalled();
});

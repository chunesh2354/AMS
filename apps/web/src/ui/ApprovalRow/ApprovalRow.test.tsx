import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApprovalRow, SELF_APPROVED_LABEL } from '.';

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

it('has no row Approve on an exception: it is approved from the preview', () => {
  render(<ul><ApprovalRow item={{ ...item, exception: 'Over 12 h day' }} onApprove={vi.fn()} /></ul>);
  expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Return' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delegate' })).toBeInTheDocument();
});
it("labels a sole principal's own work as self-approved", () => {
  render(<ul><ApprovalRow item={{ ...item, selfApproval: true }} /></ul>);
  expect(screen.getByText(SELF_APPROVED_LABEL)).toHaveTextContent('Self-approved: no other approver in the studio');
});
it('gives the actions their own grid cell beside, never over, the open button', () => {
  const { container } = render(<ul><ApprovalRow item={item} /></ul>);
  const row = container.querySelector('.apr__row')!;
  const actions = container.querySelector('.apr__actions')!;
  const openButton = container.querySelector('.apr__open')!;
  // A direct grid child of the row, after the open button, and not inside it.
  expect(actions.parentElement).toBe(row);
  expect(openButton.contains(actions)).toBe(false);
  expect(openButton.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // The stylesheet no longer lifts the actions out of the grid or hides them until hover.
  const css = readFileSync(resolve(__dirname, '../styles/workflow.css'), 'utf8');
  const rules = [...css.matchAll(/([^{}]*\.apr__actions[^{}]*)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
  expect(rules.length).toBeGreaterThan(0);
  for (const r of rules) {
    expect(r.body).not.toMatch(/position:\s*absolute/);
    expect(r.body).not.toMatch(/display:\s*none/);
    expect(r.selector).not.toMatch(/:hover|:focus-within/);
  }
  // The row grid has a column for the actions at full width (seven tracks).
  const grid = /\.apr__row \{[^}]*grid-template-columns:\s*([^;]+);/.exec(css)![1];
  expect(grid.trim().split(/\s+(?![^(]*\))/)).toHaveLength(7);
});

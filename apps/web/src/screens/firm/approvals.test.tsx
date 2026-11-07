import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openApp } from '../test-utils';

const rail = () => screen.getByRole('navigation', { name: 'Queues' });

describe('Approval inbox', () => {
  it('shows the queue rail with the brief counts', async () => {
    openApp('/firm/approvals');
    await screen.findByRole('region', { name: 'Approval items' });
    for (const name of [/All\s*14/, /Time\s*6/, /Leave\s*2/, /Expenses\s*2/, /Bills\s*1/, /Changes\s*1/, /Billing drafts\s*2/]) {
      expect(within(rail()).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(screen.getByRole('region', { name: 'Approval items' })).getAllByRole('listitem')).toHaveLength(14);
  });
  it('keeps the queue in the URL', async () => {
    const router = openApp('/firm/approvals');
    await screen.findByRole('region', { name: 'Approval items' });
    await userEvent.click(within(rail()).getByRole('button', { name: /Leave/ }));
    expect(router.state.location.search).toBe('?queue=Leave');
    expect(within(screen.getByRole('region', { name: 'Approval items' })).getAllByRole('listitem')).toHaveLength(2);
  });
  it('excludes the exception row from batch and counts it in the toast', async () => {
    openApp('/firm/approvals');
    const list = await screen.findByRole('region', { name: 'Approval items' });
    expect(within(list).getByRole('checkbox', { name: /Rohan Shetty.*exception/ })).toBeDisabled();
    await userEvent.click(within(list).getByRole('checkbox', { name: /Select all 13 eligible/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve 13 selected' }));
    expect(await screen.findByText('13 approved. 1 exception excluded.')).toBeInTheDocument();
    const left = within(screen.getByRole('region', { name: 'Approval items' })).getAllByRole('listitem');
    expect(left).toHaveLength(1);
    expect(left[0]).toHaveTextContent('Rohan Shetty');
  });
  it('returns with an inline reason', async () => {
    openApp('/firm/approvals?queue=Bills');
    const list = await screen.findByRole('region', { name: 'Approval items' });
    await userEvent.click(within(list).getByRole('button', { name: 'Return' }));
    await userEvent.type(within(list).getByLabelText('Reason for returning'), 'duplicate');
    await userEvent.click(within(list).getAllByRole('button', { name: 'Return' }).at(-1)!);
    expect(await screen.findByText(/Returned to Structural consultant: duplicate/)).toBeInTheDocument();
    expect(await screen.findByText('Nothing is waiting for you here.')).toBeInTheDocument();
  });
  it('delegates with a picker and required date range', async () => {
    openApp('/firm/approvals?queue=Bills');
    const list = await screen.findByRole('region', { name: 'Approval items' });
    await userEvent.click(within(list).getByRole('button', { name: 'Delegate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delegate approval' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delegate' }));
    expect(within(dialog).getByText('Choose a person')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose a start and end date')).toBeInTheDocument();
  });
  it.each([['error', /could not be loaded/], ['empty', /Nothing is waiting/], ['denied', /permission/]])('reaches the %s state', async (demo, text) => {
    openApp(`/firm/approvals?demo=${demo}`);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});

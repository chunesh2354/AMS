import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openApp } from '../test-utils';

describe('Firm Overview', () => {
  it('greets, shows six queues with the brief counts, and sorts attention', async () => {
    openApp('/firm/overview');
    expect(screen.getByRole('heading', { level: 1, name: 'Good afternoon, Asha' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /14\s*Pending approvals/ })).toBeInTheDocument();
    for (const name of [/3\s*Missing time/, /1\s*Overallocations/, /1\s*Overrun forecasts/, /1\s*Billing holds/, /1\s*Overdue invoices/]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    const list = screen.getByRole('region', { name: 'Needs attention' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('INV-DEMO-0007');
    expect(rows[0]).toHaveTextContent('40 d');
    expect(within(list).getByText(/PRJ-01 Working drawings/)).toBeInTheDocument();
    expect(within(list).getByText(/Divya Menon overallocated/)).toBeInTheDocument();
  });
  it('shows ready to bill and ageing to finance', async () => {
    openApp('/firm/overview');
    expect(await screen.findByText('₹4,86,000')).toBeInTheDocument();
    expect(screen.getAllByText('₹1,60,000').length).toBeGreaterThan(0);
  });
  it('fences money from a PM, never showing zero or blank', async () => {
    openApp('/firm/overview', 'P02');
    expect(await screen.findAllByRole('img', { name: /restricted/ })).toHaveLength(3);
    expect(screen.queryByText('₹4,86,000')).toBeNull();
    expect(screen.queryByText(/₹1,60,000/)).toBeNull();
    expect(screen.getByText(/amount Restricted/)).toBeInTheDocument();
  });
  it('navigates from a queue card to its filtered list', async () => {
    const router = openApp('/firm/overview');
    await userEvent.click(await screen.findByRole('button', { name: /3\s*Missing time/ }));
    expect(router.state.location.pathname + router.state.location.search).toBe('/firm/people?issue=missing-time');
  });
  it.each([['error', /could not be loaded/], ['empty', /Nothing needs attention/], ['denied', /permission/]])('reaches the %s state', async (demo, text) => {
    openApp(`/firm/overview?demo=${demo}`);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});

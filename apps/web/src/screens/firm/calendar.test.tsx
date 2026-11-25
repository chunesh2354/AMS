import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openApp } from '../test-utils';

// Mock mode: the approved design's demo items, with its "today" of Wed 25 Nov 2026.
describe('Calendar (mock)', () => {
  it('is in the Firm navigation after Workload', async () => {
    openApp('/firm/calendar');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const labels = within(nav).getAllByRole('link').map((a) => a.textContent);
    expect(labels.indexOf('Calendar')).toBe(labels.indexOf('Workload') + 1);
  });

  it('shows November with today ringed and the demo items, and opens a popover with a link to the source', async () => {
    openApp('/firm/calendar');
    const grid = await screen.findByRole('table', { name: 'November 2026' });
    const today = within(grid).getByRole('cell', { name: /^Wednesday 25 November, today/ });
    expect(today.querySelector('.is-today')).not.toBeNull();
    const fri20 = within(grid).getByRole('cell', { name: /^Friday 20 November, 2 items/ });
    expect(within(fri20).getByText('Karan Bhat on leave')).toBeInTheDocument();
    // The overdue task is marked red.
    const overdue = within(fri20).getByRole('button', { name: /Facade options set, Overdue by 5 days/ });
    await userEvent.click(overdue);
    const pop = await screen.findByRole('dialog', { name: 'PRJ-02 Facade options set' });
    expect(within(pop).getByText('Divya Menon')).toBeInTheDocument();
    expect(within(pop).getByRole('link', { name: 'Open task' })).toHaveAttribute('href', '/firm/projects/PRJ-02/tasks');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'PRJ-02 Facade options set' })).toBeNull();
    // A holiday is a band.
    expect(within(grid).getByRole('button', { name: /^Diwali, Studio holiday/ })).toBeInTheDocument();
  });

  it('switches to week and list, filters by type and moves by month', async () => {
    openApp('/firm/calendar');
    await screen.findByRole('table', { name: 'November 2026' });
    await userEvent.click(screen.getByRole('button', { name: /Leave/, pressed: true }));
    expect(screen.queryByText('Karan Bhat on leave')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Week' }));
    const week = await screen.findByRole('table', { name: '23 to 29 Nov 2026' });
    expect(within(week).getByText('PRJ-01 Area statement')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'List' }));
    const thu26 = await screen.findByRole('region', { name: /^Thursday 26 November/ });
    expect(within(thu26).getByText('PRJ-01 Area statement')).toBeInTheDocument();
    expect(within(thu26).getByText('Due in 1 day')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'December 2026' })).toBeInTheDocument();
    expect(await screen.findByText('Christmas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Billing' })).toHaveAttribute('href', '/firm/projects/PRJ-02/billing');
  });
});

import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openApp } from '../test-utils';

describe('Projects list', () => {
  it('shows three projects with risk from the brief', async () => {
    openApp('/firm/projects');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('rowheader')).toHaveLength(3);
    expect(within(table).getByText('At risk')).toBeInTheDocument();
    expect(within(table).getByText('On track')).toBeInTheDocument();
    expect(within(table.querySelector('tbody')!).getAllByText('On hold').length).toBeGreaterThan(0);
  });
  it('applies the overrun filter from Overview', async () => {
    openApp('/firm/projects?risk=at-risk');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('rowheader')).toHaveLength(1);
    expect(table).toHaveTextContent('Lakeview Residence');
  });
  it('opens the workspace from a row', async () => {
    const router = openApp('/firm/projects');
    await userEvent.click(await screen.findByText('Lakeview Residence'));
    expect(router.state.location.pathname).toBe('/firm/projects/PRJ-01');
  });
  it.each([['error', /could not be loaded/], ['empty', /No project matches/], ['denied', /permission/]])('reaches the %s state', async (demo, text) => {
    openApp(`/firm/projects?demo=${demo}`);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});

describe('Project Overview', () => {
  it('shows the PRJ-01 tiles and phases', async () => {
    openApp('/firm/projects/PRJ-01');
    expect(await screen.findByRole('heading', { level: 1, name: 'Lakeview Residence' })).toBeInTheDocument();
    expect((await screen.findAllByText('820')).length).toBeGreaterThan(0);
    expect(screen.getByText('/ 1,100 h')).toBeInTheDocument();
    expect(screen.getByText('48%')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('₹24,00,000')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Working drawings, 07 Sep 2026 to 18 Dec 2026, Overrun/ })).toBeInTheDocument();
    expect(screen.getByText('+30')).toBeInTheDocument();
  });
  it('shows Contribution to the principal', async () => {
    openApp('/firm/projects/PRJ-01', 'P01');
    expect(await screen.findByText('₹6,40,000')).toBeInTheDocument();
  });
  it('fences Contribution from the PM', async () => {
    openApp('/firm/projects/PRJ-01', 'P02');
    expect(await screen.findByRole('img', { name: /restricted/ })).toBeInTheDocument();
    expect(screen.queryByText('₹6,40,000')).toBeNull();
    expect(screen.getByText('Contribution')).toBeInTheDocument();
  });
  it('shows the hold banner on PRJ-03', async () => {
    openApp('/firm/projects/PRJ-03');
    expect(await screen.findByText('PRJ-03 is on hold')).toBeInTheDocument();
    expect(screen.getByText(/Allocations are retained/)).toBeInTheDocument();
  });
  it('handles an unknown project', async () => {
    openApp('/firm/projects/PRJ-99');
    expect(await screen.findByText('No project has that code.')).toBeInTheDocument();
  });
});

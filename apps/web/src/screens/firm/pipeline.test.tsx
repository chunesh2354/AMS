import { expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openApp } from '../test-utils';

it('shows six opportunities on the board with one overdue next action', async () => {
  openApp('/firm/pipeline');
  expect(await screen.findByText('6 opportunities')).toBeInTheDocument();
  const proposal = screen.getByRole('region', { name: 'Proposal, 1' });
  expect(within(proposal).getByText('Overdue')).toBeInTheDocument();
  expect(within(proposal).getByText('₹32,00,000')).toBeInTheDocument();
  ['New', 'Qualified', 'Won', 'Lost', 'On hold'].forEach((s) => expect(screen.getByRole('region', { name: `${s}, 1` })).toBeInTheDocument());
});

it('moves a card with the keyboard menu and opens the proposal', async () => {
  const router = openApp('/firm/pipeline');
  await userEvent.click(await screen.findByRole('button', { name: 'Move Palm Grove Villas' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Proposal' }));
  expect(screen.getByRole('region', { name: 'Proposal, 2' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^Harbour Realty/ }));
  expect(router.state.location.pathname).toBe('/firm/proposals/PROP-01');
  expect(await screen.findByRole('heading', { name: 'Harbour Studio Offices' })).toBeInTheDocument();
});

it('locks the accepted proposal and creates a project through four steps', async () => {
  openApp('/firm/proposals/PROP-01');
  expect(await screen.findByText('Accepted versions are read-only')).toBeInTheDocument();
  expect(screen.getAllByText('₹6,00,000').length).toBeGreaterThan(0);
  expect(screen.getAllByText('₹1,00,000').length).toBeGreaterThan(0);
  expect(screen.queryByRole('textbox')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
  const sheet = await screen.findByRole('dialog', { name: 'Create project' });
  expect(within(sheet).getAllByRole('listitem').slice(0, 4).map((l) => l.textContent)).toEqual(['1Project', '2Phases', '3Team', '4Review']);
  await userEvent.click(within(sheet).getByRole('button', { name: 'Save and continue' }));
  expect(within(sheet).getByText('Choose a project manager')).toBeInTheDocument();
});

it('does not offer Create project before acceptance', async () => {
  openApp('/firm/proposals/PROP-02');
  expect(await screen.findByRole('heading', { name: 'Riverside School Block' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create project' })).toBeNull();
  expect(screen.queryByText('Accepted versions are read-only')).toBeNull();
});

it('offers to start a proposal for an opportunity without one', async () => {
  openApp('/firm/proposals/OPP-02');
  expect(await screen.findByText('This opportunity has no proposal yet.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start proposal' })).toBeInTheDocument();
});

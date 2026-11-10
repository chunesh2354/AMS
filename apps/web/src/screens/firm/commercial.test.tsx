import { expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openApp } from '../test-utils';

it('totals ready to bill at ₹4,86,000', async () => {
  openApp('/firm/billing');
  const table = await screen.findByRole('region', { name: 'Ready to bill' });
  expect(within(table).getAllByText('₹4,86,000').length).toBe(1);
  expect(within(table).getByText('₹80,000')).toBeInTheDocument();
});

it('shows the approved draft in two panes and names the MOCK adapter on submit', async () => {
  openApp('/firm/billing?tab=drafts');
  expect(await screen.findByRole('heading', { name: 'DRAFT-0012' })).toBeInTheDocument();
  expect(screen.getByText('Karan Bhat, 2.00 h at ₹2,000, 26 to 28 Oct')).toBeInTheDocument();
  const calc = screen.getByRole('complementary', { name: 'Calculation basis' });
  expect(within(calc).getByText('₹4,000')).toBeInTheDocument();
  expect(within(calc).getByText('₹2,000')).toHaveClass('calc__danger');
  await userEvent.click(screen.getByRole('button', { name: 'Submit to accounting' }));
  const sheet = await screen.findByRole('dialog', { name: 'Submit to accounting' });
  expect(within(sheet).getByText('MOCK')).toBeInTheDocument();
  expect(within(sheet).getByText(/Mock accounting adapter/)).toBeInTheDocument();
  await userEvent.click(within(sheet).getByRole('button', { name: 'Submit draft' }));
  expect(await screen.findAllByRole('status', { name: 'Finalized' })).not.toHaveLength(0);
});

it('shows the accounting chip with its last success', async () => {
  openApp('/firm/billing?tab=accounting');
  expect(await screen.findByText('06 Nov 2026 14:30')).toBeInTheDocument();
  expect(screen.getByText('MOCK')).toBeInTheDocument();
  expect(screen.getByText('Enabled')).toBeInTheDocument();
});

it('denies Billing and Receivables to a project manager', async () => {
  openApp('/firm/billing', 'P02');
  expect(await screen.findByText(/You need the finance permission/)).toBeInTheDocument();
  expect(screen.getByText('Ask Asha Rao (Principal)')).toBeInTheDocument();
});

it('shows NTE eligible and excess on Project Billing, fenced for a PM', async () => {
  openApp('/firm/projects/PRJ-02/billing');
  const panel = await screen.findByRole('complementary', { name: 'NTE exceptions' });
  expect(await within(panel).findByText('₹4,000')).toBeInTheDocument();
  expect(within(panel).getByText('₹2,000')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '6% of construction cost' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Hourly NTE' })).toBeInTheDocument();
});

it('fences NTE amounts for Vikram Nair', async () => {
  openApp('/firm/projects/PRJ-02/billing', 'P02');
  const panel = await screen.findByRole('complementary', { name: 'NTE exceptions' });
  await within(panel).findByText('Requested');
  expect(within(panel).getAllByRole('img', { name: /restricted/ })).toHaveLength(3);
  expect(within(panel).queryByText('₹4,000')).toBeNull();
});

it('keeps receivable columns apart and validates a settlement', async () => {
  openApp('/firm/receivables');
  for (const h of ['Cash', 'Withholding', 'Credits', 'Outstanding']) expect(await screen.findByRole('columnheader', { name: h })).toBeInTheDocument();
  const row = screen.getByRole('rowheader', { name: 'INV-DEMO-0007' }).closest('tr')!;
  expect(within(row).getByText('Overdue 40 d')).toBeInTheDocument();
  expect(within(row).getByText('Farah Khan')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Record settlement' }));
  const sheet = await screen.findByRole('dialog', { name: 'Record settlement' });
  await userEvent.click(within(sheet).getByRole('radio', { name: 'Withholding' }));
  await userEvent.type(within(sheet).getByRole('textbox', { name: 'Withholding amount' }), '200000');
  await userEvent.click(within(sheet).getByRole('button', { name: 'Save settlement' }));
  expect(within(sheet).getByText('This is more than the ₹1,60,000 outstanding')).toBeInTheDocument();
  const input = within(sheet).getByRole('textbox', { name: 'Withholding amount' });
  await userEvent.clear(input);
  await userEvent.type(input, '16000');
  expect(within(sheet).getByText('₹1,44,000')).toBeInTheDocument();
  await userEvent.click(within(sheet).getByRole('button', { name: 'Save settlement' }));
  expect(within(row).getByText('₹16,000')).toBeInTheDocument();
});

it('flags Nisha in Utilization and disables Export when columns are fenced', async () => {
  openApp('/firm/reports/utilization');
  expect(await screen.findByRole('heading', { name: 'Utilization' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled();
  expect(screen.getByText(/Missing: Nisha Kumar cost rate/)).toBeInTheDocument();
});

it('labels Contribution a management estimate and fences it for a PM', async () => {
  openApp('/firm/reports/contribution', 'P02');
  expect(await screen.findByText('Management estimate')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Export, disabled/ })).toBeDisabled();
  expect(screen.getAllByRole('img', { name: /restricted/ }).length).toBeGreaterThan(5);
  expect(screen.queryByText('56%')).toBeNull();
});

it('shows the MOCK integration and the eleven settings sections, with Accounts after Permissions, Rates after Accounts and Approvals after Templates', async () => {
  openApp('/firm/settings/integrations');
  const card = await screen.findByRole('region', { name: 'Accounting' });
  expect(within(card).getByText('MOCK')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Payroll' })).getByText('Not configured')).toBeInTheDocument();
  const links = within(screen.getByRole('navigation', { name: 'Settings' })).getAllByRole('link');
  expect(links).toHaveLength(11);
  const labels = links.map((l) => l.textContent);
  expect(labels.indexOf('Accounts')).toBe(labels.indexOf('Permissions') + 1);
  expect(links[labels.indexOf('Accounts')]).toHaveAttribute('href', '/firm/settings/accounts');
  expect(labels.indexOf('Rates')).toBe(labels.indexOf('Accounts') + 1);
  expect(links[labels.indexOf('Rates')]).toHaveAttribute('href', '/firm/settings/rates');
  expect(labels.indexOf('Approvals')).toBe(labels.indexOf('Templates') + 1);
  expect(links[labels.indexOf('Approvals')]).toHaveAttribute('href', '/firm/settings/approvals');
});

it('blocks an import until the red cells are fixed', async () => {
  openApp('/firm/settings/imports?step=3');
  expect(await screen.findByText('2 cells need fixing before this import can run.')).toBeInTheDocument();
  const bad = screen.getByRole('button', { name: /Meera Iyar/ });
  expect(bad.closest('td')).toHaveClass('dt__cell--danger');
  await userEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
  expect(screen.getByText('Fix 2 cells to continue')).toBeInTheDocument();
  await userEvent.click(bad);
  const input = screen.getByRole('textbox', { name: 'Manager' });
  await userEvent.clear(input);
  await userEvent.type(input, 'Meera Iyer{Enter}');
  expect(await screen.findByText('1 cell needs fixing before this import can run.')).toBeInTheDocument();
});

it('denies Settings to a project manager', async () => {
  openApp('/firm/settings/profile', 'P02');
  expect(await screen.findByText(/change firm settings permission/)).toBeInTheDocument();
});

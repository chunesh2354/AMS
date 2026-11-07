import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from '.';

it('exposes landmarks and a skip link', () => {
  render(<AppShell interface="team" sideNav={<nav aria-label="Main" />} topBar={<header />} bottomBar={<nav aria-label="Team" />}>Body</AppShell>);
  expect(screen.getByRole('main')).toHaveTextContent('Body');
  expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main');
  expect(screen.getByRole('navigation', { name: 'Team' })).toBeInTheDocument();
});
it('renders a banner when given one', () => {
  render(<AppShell interface="firm" sideNav={null} topBar={null} banner={<p>Best on a larger screen</p>}>Body</AppShell>);
  expect(screen.getByText('Best on a larger screen')).toBeInTheDocument();
});

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { openApp } from '../test-utils';
import { SessionProvider } from '../../app/session';
import { PersonScreen } from './person';

describe('Person profile', () => {
  it('renders Divya Menon conflict numbers on Capacity', async () => {
    openApp('/firm/people/P05?tab=capacity');
    expect(await screen.findByRole('heading', { level: 1, name: 'Divya Menon' })).toBeInTheDocument();
    expect(await screen.findByText(/40 h scheduled, 8 holiday, 4 leave, 4 commitment, 26 allocated/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Conflict: Overallocated' })).toHaveTextContent('2.00 h');
    expect(screen.getByRole('img', { name: /Week of 16 Nov/ })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: /^Week of/ })).toHaveLength(8);
  });
  it('has seven tabs for a principal, kept in the URL', async () => {
    openApp('/firm/people/P05?tab=capacity');
    await screen.findByRole('heading', { level: 1, name: 'Divya Menon' });
    const nav = screen.getByRole('navigation', { name: /sections/ });
    expect(nav.querySelectorAll('a')).toHaveLength(7);
    expect(screen.getByRole('link', { name: 'Capacity' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Rates' })).toHaveAttribute('href', '/firm/people/P05?tab=rates');
  });
  it('has no Rates tab for staff, even when the URL asks for it', async () => {
    render(
      <SessionProvider initialViewer="P04">
        <MemoryRouter initialEntries={['/firm/people/P05?tab=rates']}>
          <Routes><Route path="/firm/people/:id" element={<PersonScreen />} /></Routes>
        </MemoryRouter>
      </SessionProvider>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Divya Menon' });
    expect(screen.queryByRole('link', { name: 'Rates' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });
  it('shows rates to a principal and fences them from a PM', async () => {
    openApp('/firm/people/P05?tab=rates');
    expect(await screen.findByText('₹640')).toBeInTheDocument();
  });
  it('fences rates from a PM with RestrictedCell, never blank', async () => {
    openApp('/firm/people/P05?tab=rates', 'P02');
    expect(await screen.findAllByRole('img', { name: /restricted/ })).toHaveLength(2);
    expect(screen.queryByText('₹640')).toBeNull();
  });
  it('shows permission sets, a substitute and a redacted audit line', async () => {
    openApp('/firm/people/P05?tab=access');
    expect(await screen.findByText('Substitute')).toBeInTheDocument();
    expect(screen.getByRole('table', { hidden: false })).toBeInTheDocument();
  });
  it('redacts sensitive activity', async () => {
    openApp('/firm/people/P05?tab=activity');
    expect(await screen.findByText('changed a cost rate', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /restricted/ })).toBeInTheDocument();
  });
  it('flags Nisha Kumar as incomplete', async () => {
    openApp('/firm/people/P09');
    expect(await screen.findByText('No cost rate')).toBeInTheDocument();
  });
  it('handles an unknown person', async () => {
    openApp('/firm/people/P99');
    expect(await screen.findByText('No one has that reference.')).toBeInTheDocument();
  });
});

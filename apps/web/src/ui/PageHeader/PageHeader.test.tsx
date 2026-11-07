import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageHeader } from '.';

it('renders the title, breadcrumb and active tab', () => {
  render(
    <MemoryRouter initialEntries={['/p/phases']}>
      <PageHeader title="Lakeview" breadcrumb={[{ label: 'Projects', to: '/p' }, { label: 'PRJ-01' }]} tabs={[{ label: 'Overview', to: '/p', end: true }, { label: 'Phases', to: '/p/phases' }]} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Lakeview' })).toHaveClass('t-h1');
  expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/p');
  expect(screen.getByRole('link', { name: 'Phases' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
});

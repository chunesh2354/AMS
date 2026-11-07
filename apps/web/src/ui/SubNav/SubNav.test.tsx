import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SubNav } from '.';

it('marks the current page', () => {
  render(<MemoryRouter initialEntries={['/b']}><SubNav label="Settings" items={[{ label: 'A', to: '/a' }, { label: 'B', to: '/b' }]} /></MemoryRouter>);
  expect(screen.getByRole('link', { name: 'B' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'A' })).not.toHaveAttribute('aria-current');
});

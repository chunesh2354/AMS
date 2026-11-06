import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiTile } from '.';

it('hides the value when restricted, never showing zero', () => {
  render(<KpiTile label="Contribution" value="₹0" restricted />);
  expect(screen.queryByText('₹0')).toBeNull();
  expect(screen.getByRole('img', { name: /restricted/ })).toBeInTheDocument();
});
it('rings the value when incomplete', () => {
  render(<KpiTile label="Utilization" value="72%" complete={false} missing={['cost rate']} />);
  expect(screen.getByRole('group', { name: /Missing: cost rate/ })).toHaveTextContent('72%');
});

import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EntitlementBar } from '.';

it('lists five mono amounts in en-IN', () => {
  render(<EntitlementBar contracted={2400000} entitled={1120000} drafted={800000} invoiced={560000} collected={400000} />);
  expect(screen.getByText('₹24,00,000')).toBeInTheDocument();
  expect(screen.getByText('₹4,00,000')).toBeInTheDocument();
  expect(screen.getAllByRole('term')).toHaveLength(5);
});

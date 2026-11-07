import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompareColumns } from '.';

it('renders one column per entry and flags danger values', () => {
  render(<CompareColumns label="Budget" columns={[{ label: 'Baseline', value: '200', unit: 'h' }, { label: 'Forecast', value: '230', unit: 'h', danger: true }]} />);
  expect(screen.getByRole('group', { name: 'Budget' })).toBeInTheDocument();
  expect(screen.getByText('230').closest('.compare__value')).toHaveClass('compare__value--danger');
});

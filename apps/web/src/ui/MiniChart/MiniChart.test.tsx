import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MiniChart } from '.';

it('keeps donut values readable as text', () => {
  render(<MiniChart kind="donut" label="Ageing" data={[{ label: 'Current', value: 10, color: 'ok', display: '₹10' }]} />);
  expect(screen.getByRole('group', { name: 'Ageing' })).toHaveTextContent('Current');
  expect(screen.getAllByText('₹10').length).toBeGreaterThan(0);
});
it('labels each bar', () => {
  render(<MiniChart kind="bar" label="Hours" data={[{ label: 'Week 1', value: 32 }]} />);
  expect(screen.getByRole('img', { name: 'Week 1: 32' })).toBeInTheDocument();
});

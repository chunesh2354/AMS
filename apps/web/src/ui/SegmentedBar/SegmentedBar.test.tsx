import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SegmentedBar } from '.';

it('names every segment and draws only non-zero ones', () => {
  const { container } = render(<SegmentedBar label="Ageing" segments={[{ label: 'Current', value: 0, display: '₹0', color: 'ok' }, { label: '30 d', value: 160000, display: '₹1,60,000', color: 'warn' }]} />);
  expect(screen.getByRole('img', { name: 'Ageing: Current ₹0, 30 d ₹1,60,000' })).toBeInTheDocument();
  expect(container.querySelectorAll('.segbar__seg')).toHaveLength(1);
});

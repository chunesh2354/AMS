import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DayTotalRing } from '.';

it('announces hours and warns over 12 h', () => {
  render(<DayTotalRing hours={12.5} scheduled={8} label="Thursday" />);
  const ring = screen.getByRole('img', { name: 'Thursday: 12.50 h of 8.00 h scheduled, over 12 hours' });
  expect(ring).toHaveClass('ring--over');
});
it('stays ok at 12 h', () => {
  render(<DayTotalRing hours={12} scheduled={8} />);
  expect(screen.getByRole('img')).not.toHaveClass('ring--over');
});

import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AvailabilityBar, availableHours } from '.';

it('reports the Divya Menon conflict', () => {
  const week = { scheduled: 40, holiday: 8, leave: 4, commitments: 4, allocated: 26 };
  expect(availableHours(week)).toBe(24);
  render(<AvailabilityBar {...week} label="16 Nov" />);
  expect(screen.getByText('+2.00 h')).toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAccessibleName('Week of 16 Nov: 40 h scheduled, 8 holiday, 4 leave, 4 commitment, 26 allocated, 2 h over');
});
it('shows free hours otherwise', () => {
  render(<AvailabilityBar scheduled={40} holiday={0} leave={0} commitments={4} allocated={24} />);
  expect(screen.getByText('12.00 h free')).toBeInTheDocument();
});

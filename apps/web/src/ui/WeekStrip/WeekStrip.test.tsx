import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WeekStrip } from '.';

it('hatches leave weeks and marks today', () => {
  render(<WeekStrip label="Weeks" weeks={[{ label: '02 Nov', today: true }, { label: '16 Nov', kind: 'leave', note: 'Leave 2 d' }]} />);
  expect(screen.getByText('Today')).toBeInTheDocument();
  expect(screen.getByText('Leave 2 d').closest('li')).toHaveClass('plan__c--off');
});

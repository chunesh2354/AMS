import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GanttStrip } from '.';

it('exposes each phase with dates and status', () => {
  render(<GanttStrip phases={[{ name: 'Tender', start: '2026-12-21', end: '2027-02-05', status: 'Planned' }]} />);
  expect(screen.getByRole('img', { name: 'Tender, 21 Dec 2026 to 05 Feb 2027, Planned' })).toBeInTheDocument();
});

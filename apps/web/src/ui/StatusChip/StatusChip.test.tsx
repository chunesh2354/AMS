import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusChip } from '.';

it('announces the status word and reads tone from the map', () => {
  render(<StatusChip status="On hold" />);
  const c = screen.getByLabelText('On hold');
  expect(c).toHaveClass('tone-neutral');
});
it('drops the disambiguating suffix from the label', () => {
  render(<StatusChip status="Pending (approval)" />);
  expect(screen.getByLabelText('Pending')).toHaveClass('tone-warn');
});

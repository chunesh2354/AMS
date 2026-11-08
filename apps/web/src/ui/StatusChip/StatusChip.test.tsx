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
it('draws the square marker the status map names, beside the visible word', () => {
  render(<><StatusChip status="Overdue" /><StatusChip status="Draft" /><StatusChip status="Paid" /><StatusChip status="Approved" /></>);
  const marker = (name: string) => screen.getByLabelText(name).querySelector('.chip__dot');
  expect(screen.getByLabelText('Overdue')).toHaveTextContent('Overdue');
  expect(marker('Overdue')).toHaveClass('marker--alert');
  expect(marker('Draft')).toHaveClass('marker--outlined');
  expect(marker('Paid')).toHaveClass('marker--done');
  expect(marker('Approved')).toHaveClass('marker--filled');
});
it('keeps the dot-only form named by the status word', () => {
  render(<StatusChip status="Overrun" dot />);
  expect(screen.getByRole('img', { name: 'Overrun' })).toHaveClass('marker--alert');
});

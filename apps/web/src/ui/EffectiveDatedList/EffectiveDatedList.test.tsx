import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EffectiveDatedList } from '.';

it('marks past, current and future', () => {
  render(<EffectiveDatedList current={1} versions={[{ from: '2025-01-01', label: 'A' }, { from: '2026-01-01', label: 'B' }, { from: '2027-01-01', label: 'C' }]} />);
  const items = screen.getAllByRole('listitem');
  expect(items[0]).toHaveClass('edl__item--past');
  expect(items[1]).toHaveAttribute('aria-current', 'true');
  expect(items[2]).toHaveClass('edl__item--future');
});

import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NumberField } from '.';

it('uses a decimal keypad', () => {
  render(<NumberField label="Hours" />);
  expect(screen.getByLabelText('Hours')).toHaveAttribute('inputmode', 'decimal');
});

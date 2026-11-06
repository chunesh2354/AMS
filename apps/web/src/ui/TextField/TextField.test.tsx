import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextField } from '.';

it('ties the error to the input', () => {
  render(<TextField label="Code" error="Already in use" />);
  const input = screen.getByLabelText('Code');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription('Already in use');
});

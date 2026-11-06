import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Checkbox } from '.';

it('sets the indeterminate DOM property', () => {
  render(<Checkbox label="All" indeterminate readOnly />);
  expect((screen.getByRole('checkbox') as HTMLInputElement).indeterminate).toBe(true);
});

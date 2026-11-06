import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BudgetBar } from '.';

it('shows the Working drawings overrun of +30 h', () => {
  render(<BudgetBar baseline={200} actual={170} forecast={230} />);
  expect(screen.getByText('+30.00 h')).toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAccessibleName('170 of 200 hours used, forecast 230, 30 over budget');
});

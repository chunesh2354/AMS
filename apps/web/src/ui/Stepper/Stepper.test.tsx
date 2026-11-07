import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stepper } from '.';

it('marks the current step', () => {
  render(<Stepper steps={['One', 'Two']} current={1} />);
  expect(screen.getByText('Two').closest('li')).toHaveAttribute('aria-current', 'step');
  expect(screen.getByText('One').closest('li')).toHaveClass('is-done');
});

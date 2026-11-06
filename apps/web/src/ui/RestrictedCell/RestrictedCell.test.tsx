import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RestrictedCell } from '.';

it('announces restricted and the reason', () => {
  render(<RestrictedCell />);
  expect(screen.getByRole('img', { name: 'restricted, requires finance permission' })).toBeInTheDocument();
});

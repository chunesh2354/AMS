import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar, AvatarGroup, initials } from '.';

it('uses two-letter initials', () => {
  expect(initials('Asha Rao')).toBe('AR');
  render(<Avatar name="Asha Rao" />);
  expect(screen.getByRole('img', { name: 'Asha Rao' })).toHaveTextContent('AR');
});
it('collapses extras into +n', () => {
  render(<AvatarGroup names={['A B', 'C D', 'E F', 'G H']} max={2} />);
  expect(screen.getByText('+2')).toBeInTheDocument();
});

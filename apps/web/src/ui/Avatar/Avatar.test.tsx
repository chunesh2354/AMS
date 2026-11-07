import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar, AvatarGroup, initials } from '.';

it('uses two-letter initials', () => {
  expect(initials('Asha Rao')).toBe('AR');
  render(<Avatar name="Asha Rao" />);
  expect(screen.getByRole('img', { name: 'Asha Rao' })).toHaveTextContent('AR');
});
it('accepts explicit text for things that are not people', () => {
  render(<AvatarGroup names={['PRJ-01']} text={(n) => n.slice(-2)} />);
  expect(screen.getByRole('img', { name: 'PRJ-01' })).toHaveTextContent('01');
});
it('collapses extras into +n', () => {
  render(<AvatarGroup names={['A B', 'C D', 'E F', 'G H']} max={2} />);
  expect(screen.getByText('+2')).toBeInTheDocument();
});

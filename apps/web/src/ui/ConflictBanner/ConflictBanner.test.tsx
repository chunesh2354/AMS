import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConflictBanner } from '.';

it('renders the conflict hours for Divya', () => {
  render(<ConflictBanner kind="overallocated" hoursOver={2} />);
  expect(screen.getByRole('group', { name: 'Conflict: Overallocated' })).toHaveTextContent('2.00 h');
});

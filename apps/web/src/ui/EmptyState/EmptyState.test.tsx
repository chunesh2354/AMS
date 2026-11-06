import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '.';

it('shows its message and action', () => {
  render(<EmptyState message="Nothing here." action={<button>Add</button>} />);
  expect(screen.getByText('Nothing here.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
});

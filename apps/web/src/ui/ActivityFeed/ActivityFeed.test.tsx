import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActivityFeed } from '.';

it('redacts sensitive changes', () => {
  render(<ActivityFeed days={[{ day: 'Today', events: [{ id: '1', actor: 'Farah Khan', action: 'changed a rate', sensitive: true, previous: '₹900', next: '₹1,000' }] }]} />);
  expect(screen.queryByText('₹1,000')).toBeNull();
  expect(screen.getByRole('img', { name: /restricted/ })).toBeInTheDocument();
});

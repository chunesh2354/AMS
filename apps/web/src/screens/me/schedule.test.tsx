import { expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { openApp } from '../test-utils';

it('shows four read-only weeks for Rohan with leave, holidays and site visits', async () => {
  openApp('/me/schedule', 'P04');
  const grid = await screen.findByRole('grid', { name: 'My schedule' });
  const week2 = within(grid).getByRole('rowheader', { name: /09 Nov/ });
  expect(week2).toHaveTextContent('20 h');
  expect(within(grid).getAllByText('Leave')).toHaveLength(2);
  expect(within(grid).getByText('Holiday')).toBeInTheDocument();
  expect(within(grid).getAllByText('Lakeview site')).toHaveLength(2);
  within(grid).getAllByRole('button').forEach((b) => expect(b).toHaveAttribute('draggable', 'false'));
});

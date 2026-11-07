import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { BottomTabBar } from '.';

it('marks the active tab and opens More', async () => {
  render(
    <MemoryRouter initialEntries={['/me/time']}>
      <BottomTabBar label="Team" items={[{ label: 'Time', to: '/me/time', icon: <i /> }, { label: 'More', icon: <i />, menu: [{ label: 'Leave' }] }]} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Time' })).toHaveAttribute('aria-current', 'page');
  await userEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByRole('menuitem', { name: 'Leave' })).toBeInTheDocument();
});

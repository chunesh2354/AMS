import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopBar } from '.';

const notifications = [{ label: 'Today', items: [{ id: '1', text: 'Overdue invoice', time: '09:00', unread: true }] }];
const base = { onSearch: () => {}, notifications, userName: 'Asha Rao', menuItems: [{ label: 'My profile' }] };

it('opens search and counts unread', async () => {
  const onSearch = vi.fn();
  render(<TopBar {...base} onSearch={onSearch} />);
  await userEvent.click(screen.getByRole('button', { name: /Search people/ }));
  expect(onSearch).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument();
});
it('groups notifications and marks all read', async () => {
  const onMarkAllRead = vi.fn();
  render(<TopBar {...base} onMarkAllRead={onMarkAllRead} />);
  await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
  expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
  expect(onMarkAllRead).toHaveBeenCalled();
});
it('opens the avatar menu', async () => {
  render(<TopBar {...base} />);
  await userEvent.click(screen.getByRole('button', { name: /Asha Rao.*account menu/ }));
  expect(screen.getByRole('menuitem', { name: 'My profile' })).toBeInTheDocument();
});

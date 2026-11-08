import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SideNav } from '.';

const sections = [{ label: 'Work', items: [{ to: '/a', label: 'Overview', icon: <i /> }, { to: '/b', label: 'Approvals', icon: <i />, badge: 14 }] }];
const wrap = (node: React.ReactNode) => render(<MemoryRouter initialEntries={['/b']}>{node}</MemoryRouter>);

it('marks the active item and shows the badge', () => {
  wrap(<SideNav brand="Demo" sections={sections} />);
  expect(screen.getByRole('link', { name: /Approvals/ })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('14')).toBeInTheDocument();
});
it('keeps accessible names when collapsed', () => {
  wrap(<SideNav brand="Demo" collapsed sections={sections} />);
  expect(screen.getByRole('link', { name: 'Approvals, 14' })).toBeInTheDocument();
  expect(screen.queryByText('Work')).toBeNull();
});
it('hides the switcher for single-interface people', () => {
  wrap(<SideNav brand="Demo" sections={sections} />);
  expect(screen.queryByRole('radiogroup')).toBeNull();
});
it('switches interface', async () => {
  const onChange = vi.fn();
  wrap(<SideNav brand="Demo" sections={sections} switcher={{ value: 'firm', onChange }} />);
  await userEvent.click(screen.getByRole('radio', { name: 'Team' }));
  expect(onChange).toHaveBeenCalledWith('team');
});
it('shows the signed-in person with the account menu and Sign out', async () => {
  const onSignOut = vi.fn();
  wrap(<SideNav brand="Demo" sections={sections} user={{ name: 'Asha Rao', title: 'Principal', menuItems: [{ label: 'My profile' }], onSignOut }} />);
  expect(screen.getByText('Practice')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Asha Rao.*account menu/ }));
  expect(screen.getByRole('menuitem', { name: 'My profile' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(onSignOut).toHaveBeenCalled();
});

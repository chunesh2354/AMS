import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarRange, Inbox, LayoutDashboard, Users } from 'lucide-react';
import { SideNav, type NavSection } from '.';

const meta: Meta<typeof SideNav> = { title: 'Shell/SideNav', component: SideNav, parameters: { layout: 'fullscreen', route: '/firm/approvals' } };
export default meta;
const i = { size: 20, strokeWidth: 1.5, 'aria-hidden': true };
const sections: NavSection[] = [
  { label: 'Work', items: [{ to: '/firm/overview', label: 'Overview', icon: <LayoutDashboard {...i} /> }, { to: '/firm/approvals', label: 'Approvals', icon: <Inbox {...i} />, badge: 14 }] },
  { label: 'People', items: [{ to: '/firm/people', label: 'People', icon: <Users {...i} /> }, { to: '/firm/workload', label: 'Workload', icon: <CalendarRange {...i} /> }] },
];
const user = { name: 'Asha Rao', title: 'Principal', menuItems: [{ label: 'My profile' }], onSignOut: () => {} };
export const Expanded: StoryObj = { render: () => <SideNav brand="Studio Meridian (DEMO)" sections={sections} onToggleCollapsed={() => {}} switcher={{ value: 'firm', onChange: () => {} }} user={user} /> };
export const Collapsed: StoryObj = { render: () => <SideNav collapsed brand="Studio Meridian (DEMO)" sections={sections} onToggleCollapsed={() => {}} switcher={{ value: 'firm', onChange: () => {} }} user={user} /> };
export const SingleInterface: StoryObj = { render: () => <SideNav brand="Studio Meridian (DEMO)" sections={sections} /> };

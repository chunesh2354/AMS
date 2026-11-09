import {
  CalendarDays, CalendarRange, ChartColumn, Clock, Ellipsis, FolderKanban, House, IndianRupee, Inbox, Kanban,
  LayoutDashboard, Receipt, SlidersHorizontal, SquareCheckBig, Sun, Users,
} from 'lucide-react';
import type { NavSection } from '../ui/SideNav';
import type { TabItem } from '../ui/BottomTabBar';
import type { MenuItem } from '../ui/Menu';

const i = { size: 20, strokeWidth: 1.5, 'aria-hidden': true } as const;

/** The mock's Approvals count. Live mode passes the real count (or nothing) to firmNav instead. */
export const MOCK_APPROVALS_BADGE = 14;

/** The firm navigation. `approvalsBadge` is the pending count; leave it out to show no badge. */
export const firmNav = (approvalsBadge?: number): NavSection[] => [
  { label: 'Work', items: [
    { to: '/firm/overview', label: 'Overview', icon: <LayoutDashboard {...i} /> },
    { to: '/firm/projects', label: 'Projects', icon: <FolderKanban {...i} /> },
    { to: '/firm/approvals', label: 'Approvals', icon: <Inbox {...i} />, badge: approvalsBadge },
  ] },
  { label: 'People', items: [
    { to: '/firm/people', label: 'People', icon: <Users {...i} /> },
    { to: '/firm/workload', label: 'Workload', icon: <CalendarRange {...i} /> },
  ] },
  { label: 'Commercial', items: [
    { to: '/firm/pipeline', label: 'Pipeline', icon: <Kanban {...i} /> },
    { to: '/firm/billing', label: 'Billing', icon: <Receipt {...i} /> },
    { to: '/firm/receivables', label: 'Receivables', icon: <IndianRupee {...i} /> },
  ] },
  { label: 'Insights', items: [{ to: '/firm/reports/utilization', label: 'Reports', icon: <ChartColumn {...i} /> }] },
  { label: 'Settings', items: [{ to: '/firm/settings/profile', label: 'Settings', icon: <SlidersHorizontal {...i} /> }] },
];

/** The mock build's navigation, with the sample Approvals count. */
export const FIRM_NAV: NavSection[] = firmNav(MOCK_APPROVALS_BADGE);

export const TEAM_NAV: NavSection[] = [
  { items: [
    { to: '/me/home', label: 'Home', icon: <House {...i} /> },
    { to: '/me/work', label: 'Work', icon: <SquareCheckBig {...i} /> },
    { to: '/me/schedule', label: 'Schedule', icon: <CalendarDays {...i} /> },
    { to: '/me/time', label: 'Time', icon: <Clock {...i} /> },
    { to: '/me/expenses', label: 'Expenses', icon: <Receipt {...i} /> },
    { to: '/me/leave', label: 'Leave', icon: <Sun {...i} /> },
  ] },
];

export const teamTabs = (go: (to: string) => void): TabItem[] => {
  const more: MenuItem[] = [
    { label: 'Expenses', onSelect: () => go('/me/expenses') },
    { label: 'Leave', onSelect: () => go('/me/leave') },
    { label: 'Profile', onSelect: () => go('/me/profile') },
  ];
  return [
    { label: 'Home', to: '/me/home', icon: <House {...i} /> },
    { label: 'Work', to: '/me/work', icon: <SquareCheckBig {...i} /> },
    { label: 'Time', to: '/me/time', icon: <Clock {...i} /> },
    { label: 'Schedule', to: '/me/schedule', icon: <CalendarDays {...i} /> },
    { label: 'More', icon: <Ellipsis {...i} />, menu: more },
  ];
};

/** Section 11: Approvals and Overview stay usable on a phone; everything else is under More. */
export const firmTabs = (go: (to: string) => void, nav: NavSection[] = FIRM_NAV): TabItem[] => [
  { label: 'Overview', to: '/firm/overview', icon: <LayoutDashboard {...i} /> },
  { label: 'Approvals', to: '/firm/approvals', icon: <Inbox {...i} /> },
  { label: 'More', icon: <Ellipsis {...i} />, menu: nav.flatMap((s) => s.items)
    .filter((n) => !['/firm/overview', '/firm/approvals'].includes(n.to))
    .map((n) => ({ label: n.label, onSelect: () => go(n.to) })) },
];

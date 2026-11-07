import type { Meta, StoryObj } from '@storybook/react-vite';
import { Inbox, LayoutDashboard } from 'lucide-react';
import { AppShell } from '.';
import { Button } from '../Button';
import { PageHeader } from '../PageHeader';
import { QueueCard } from '../QueueCard';
import { SideNav } from '../SideNav';
import { TopBar } from '../TopBar';
import { TimerPill } from '../TimerPill';

const meta: Meta<typeof AppShell> = { title: 'Shell/AppShell', component: AppShell, parameters: { layout: 'fullscreen', route: '/firm/overview' } };
export default meta;
const i = { size: 20, strokeWidth: 1.5, 'aria-hidden': true };
export const Firm: StoryObj = {
  render: () => (
    <AppShell
      interface="firm"
      sideNav={<SideNav brand="Studio Meridian (DEMO)" sections={[{ label: 'Work', items: [{ to: '/firm/overview', label: 'Overview', icon: <LayoutDashboard {...i} /> }, { to: '/firm/approvals', label: 'Approvals', icon: <Inbox {...i} />, badge: 14 }] }]} />}
      topBar={<TopBar onSearch={() => {}} notifications={[]} userName="Asha Rao" menuItems={[{ label: 'My profile' }]} timer={<TimerPill state="idle" />} />}
    >
      <PageHeader display title="Good afternoon, Asha" meta={<span className="t-numeric ink-2">06 Nov 2026</span>} primaryAction={<Button variant="primary">Add person</Button>} />
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <QueueCard count={3} label="Missing time" severity="warn" />
        <QueueCard count={14} label="Pending approvals" severity="warn" />
        <QueueCard count={1} label="Overdue invoices" severity="danger" />
      </div>
    </AppShell>
  ),
};

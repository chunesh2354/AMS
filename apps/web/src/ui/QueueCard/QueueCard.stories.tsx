import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueueCard } from '.';

const meta: Meta<typeof QueueCard> = { title: 'Data display/QueueCard', component: QueueCard };
export default meta;
export const Overview: StoryObj = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(6, 1fr)', padding: 32 }}>
      <QueueCard count={3} label="Missing time" severity="warn" onClick={() => {}} />
      <QueueCard count={14} label="Pending approvals" severity="warn" trend={{ direction: 'up', text: '2' }} onClick={() => {}} />
      <QueueCard count={1} label="Overallocations" severity="danger" onClick={() => {}} />
      <QueueCard count={1} label="Overrun forecasts" severity="danger" onClick={() => {}} />
      <QueueCard count={1} label="Billing holds" severity="neutral" onClick={() => {}} />
      <QueueCard count={1} label="Overdue invoices" severity="danger" restricted onClick={() => {}} />
    </div>
  ),
};

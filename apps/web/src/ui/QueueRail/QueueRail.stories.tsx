import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueueRail } from '.';

const meta: Meta<typeof QueueRail> = { title: 'Approval/QueueRail', component: QueueRail };
export default meta;
function Demo() {
  const [v, set] = useState('all');
  return <div style={{ maxWidth: 200 }}><QueueRail label="Queues" value={v} onChange={set} items={[{ key: 'all', label: 'All', count: 14 }, { key: 'time', label: 'Time', count: 6 }, { key: 'leave', label: 'Leave', count: 2 }, { key: 'expenses', label: 'Expenses', count: 2 }, { key: 'bills', label: 'Bills', count: 1 }, { key: 'changes', label: 'Changes', count: 1 }, { key: 'drafts', label: 'Billing drafts', count: 2 }]} /></div>;
}
export const Default: StoryObj = { render: () => <Demo /> };

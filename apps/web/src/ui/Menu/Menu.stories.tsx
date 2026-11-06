import type { Meta, StoryObj } from '@storybook/react-vite';
import { Check, CornerUpLeft, UserPlus, X } from 'lucide-react';
import { Menu } from '.';
import { Button } from '../Button';

const meta: Meta<typeof Menu> = { title: 'Feedback/Menu', component: Menu };
export default meta;
const i = { size: 16, strokeWidth: 1.5, 'aria-hidden': true };
export const Open: StoryObj = {
  render: () => (
    <div style={{ height: 220 }}>
      <Menu defaultOpen label="Row actions" trigger={(p) => <Button {...p}>Actions</Button>} items={[
        { type: 'heading', label: 'Approval' },
        { label: 'Approve', icon: <Check {...i} /> },
        { label: 'Return', icon: <CornerUpLeft {...i} /> },
        { label: 'Delegate', icon: <UserPlus {...i} />, disabled: true },
        { type: 'separator' },
        { label: 'Reject', icon: <X {...i} />, danger: true },
      ]} />
    </div>
  ),
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bell } from 'lucide-react';
import { IconButton } from '.';

const meta: Meta<typeof IconButton> = { title: 'Input/IconButton', component: IconButton };
export default meta;
const icon = <Bell size={20} strokeWidth={1.5} aria-hidden />;
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <IconButton label="Notifications" icon={icon} />
      <IconButton label="Notifications, dense" dense icon={icon} />
      <IconButton label="Notifications, disabled" disabled icon={icon} />
    </div>
  ),
};

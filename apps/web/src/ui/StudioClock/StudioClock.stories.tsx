import type { Meta, StoryObj } from '@storybook/react-vite';
import { StudioClock } from '.';

const meta: Meta<typeof StudioClock> = { title: 'Display/StudioClock', component: StudioClock };
export default meta;

export const Studio: StoryObj<typeof StudioClock> = {
  render: (args) => <div style={{ maxWidth: 640 }}><StudioClock {...args} /></div>,
};

export const Platform: StoryObj<typeof StudioClock> = {
  args: { place: 'Platform time, India', label: 'Platform time' },
  render: (args) => <div style={{ maxWidth: 640 }}><StudioClock {...args} /></div>,
};

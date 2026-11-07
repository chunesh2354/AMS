import type { Meta, StoryObj } from '@storybook/react-vite';
import { WeekStrip } from '.';

const meta: Meta<typeof WeekStrip> = { title: 'Planning/WeekStrip', component: WeekStrip };
export default meta;
export const Default: StoryObj = {
  render: () => <WeekStrip label="Next 4 weeks" weeks={[{ label: '02 Nov', today: true }, { label: '09 Nov' }, { label: '16 Nov', kind: 'leave', note: 'Leave 2 d' }, { label: '23 Dec', kind: 'holiday', note: 'Holiday' }]} />,
};

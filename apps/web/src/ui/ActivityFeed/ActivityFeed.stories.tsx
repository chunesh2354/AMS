import type { Meta, StoryObj } from '@storybook/react-vite';
import { ActivityFeed } from '.';

const meta: Meta<typeof ActivityFeed> = { title: 'Data display/ActivityFeed', component: ActivityFeed };
export default meta;
export const Project: StoryObj<typeof ActivityFeed> = {
  decorators: [(S) => <div style={{ maxWidth: 560 }}><S /></div>],
  args: {
    days: [
      { day: '06 Nov 2026', events: [
        { id: '1', actor: 'Vikram Nair', action: 'revised ETC on Working drawings', previous: '30 h', next: '60 h', time: '14:30' },
        { id: '2', actor: 'Farah Khan', action: 'changed a cost rate', sensitive: true, time: '11:05' },
      ] },
      { day: '05 Nov 2026', events: [{ id: '3', actor: 'Vikram Nair', action: 'returned a time entry from Arjun Das: wrong phase', time: '17:12' }] },
    ],
  },
};

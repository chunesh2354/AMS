import type { Meta, StoryObj } from '@storybook/react-vite';
import { GanttStrip } from '.';

const meta: Meta<typeof GanttStrip> = { title: 'Data display/GanttStrip', component: GanttStrip };
export default meta;
export const Lakeview: StoryObj<typeof GanttStrip> = {
  args: {
    today: '2026-11-06',
    phases: [
      { name: 'Concept design', start: '2026-02-02', end: '2026-04-10', status: 'Done' },
      { name: 'Schematic design', start: '2026-04-13', end: '2026-06-26', status: 'Done' },
      { name: 'Design development', start: '2026-06-29', end: '2026-09-04', status: 'Done' },
      { name: 'Working drawings', start: '2026-09-07', end: '2026-12-18', status: 'Overrun' },
      { name: 'Tender', start: '2026-12-21', end: '2027-02-05', status: 'Planned' },
      { name: 'Site supervision', start: '2027-02-08', end: '2027-11-26', status: 'Planned' },
    ],
  },
};

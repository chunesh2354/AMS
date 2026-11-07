import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { TimesheetGrid, type TimesheetLine } from '.';

const meta: Meta<typeof TimesheetGrid> = { title: 'Planning/TimesheetGrid', component: TimesheetGrid };
export default meta;
const days = [['Mon', '02', 8], ['Tue', '03', 8], ['Wed', '04', 8], ['Thu', '05', 8], ['Fri', '06', 8], ['Sat', '07', 0], ['Sun', '08', 0]].map(([label, date, scheduled]) => ({ key: String(label), label: String(label), date: String(date), scheduled: Number(scheduled) }));
const start: TimesheetLine[] = [
  { id: 'a', title: 'Concept design', subtitle: 'PRJ-01 Lakeview Residence', hours: [4, 4, 3, 6.5, 2, 0, 0] },
  { id: 'b', title: 'Working drawings', subtitle: 'PRJ-01 Lakeview Residence', hours: [2, 2, 3, 4, 0, 0, 0], state: 'returned', reason: 'Returned by Vikram Nair: wrong phase' },
  { id: 'c', title: 'Schematic design', subtitle: 'PRJ-02 Orchard Commercial Block', hours: [0, 1, 1, 2, 0, 0, 0], state: 'locked' },
  { id: 'd', title: 'Unclassified', hours: [1, 1, 0, 0, 0, 0, 0], state: 'unclassified', reason: 'Choose a project and phase' },
];
function Live() {
  const [lines, set] = useState(start);
  return <TimesheetGrid label="Week of 02 Nov" days={days} lines={lines} onAddLine={() => {}} onChange={(id, d, h) => set((l) => l.map((x) => (x.id === id ? { ...x, hours: x.hours.map((v, i) => (i === d ? h : v)) } : x)))} />;
}
export const AllRowStates: StoryObj = { render: () => <Live /> };

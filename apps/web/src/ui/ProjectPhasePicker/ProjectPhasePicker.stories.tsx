import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProjectPhasePicker } from '.';

const meta: Meta<typeof ProjectPhasePicker> = { title: 'Input/ProjectPhasePicker', component: ProjectPhasePicker };
export default meta;
const PROJECTS = [
  { code: 'PRJ-01', name: 'Lakeview Residence', phases: [{ id: 'p1-concept', name: 'Concept design' }, { id: 'p1-wd', name: 'Working drawings' }] },
  { code: 'PRJ-02', name: 'Orchard Commercial Block', phases: [{ id: 'p2-sd', name: 'Schematic design' }] },
];
export const Closed: StoryObj = { render: () => <div style={{ maxWidth: 360 }}><ProjectPhasePicker label="Project and phase" projects={PROJECTS} value="p1-wd" /></div> };
export const Open: StoryObj = { render: () => <div style={{ height: 300, maxWidth: 360 }}><ProjectPhasePicker defaultOpen label="Project and phase" projects={PROJECTS} recent={['p1-concept']} value={null} /></div> };

import type { Meta, StoryObj } from '@storybook/react-vite';
import { PersonPicker } from '.';

const meta: Meta<typeof PersonPicker> = { title: 'Input/PersonPicker', component: PersonPicker };
export default meta;
const PEOPLE = [
  { id: 'P01', name: 'Asha Rao', title: 'Principal' }, { id: 'P02', name: 'Vikram Nair', title: 'Project architect' },
  { id: 'P03', name: 'Meera Iyer', title: 'Project architect' }, { id: 'P04', name: 'Rohan Shetty', title: 'Senior architect' },
  { id: 'P05', name: 'Divya Menon', title: 'Architect' },
];
export const Closed: StoryObj = { render: () => <div style={{ maxWidth: 320 }}><PersonPicker label="Approver" people={PEOPLE} value="P02" /></div> };
export const Open: StoryObj = { render: () => <div style={{ height: 340, maxWidth: 320 }}><PersonPicker defaultOpen label="Delegate to" people={PEOPLE} recent={['P02', 'P03']} value={null} /></div> };

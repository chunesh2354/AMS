import type { Meta, StoryObj } from '@storybook/react-vite';
import { CommandPalette, type PaletteAction } from '.';

const meta: Meta<typeof CommandPalette> = { title: 'Shell/CommandPalette', component: CommandPalette, parameters: { layout: 'fullscreen' } };
export default meta;
const a = (id: string, label: string, group: string, meta?: string): PaletteAction => ({ id, label, group, meta, onSelect: () => {} });
const actions = [
  a('log', 'Log time', 'Actions'), a('leave', 'Request leave', 'Actions'),
  a('approvals', 'Approvals', 'Navigate', '14 pending'), a('workload', 'Workload', 'Navigate'),
  a('person', 'Add person', 'Create'),
  a('p2', 'Vikram Nair', 'People', 'Project architect'),
  a('prj1', 'PRJ-01 Lakeview Residence', 'Projects', 'Active'),
];
const box = (node: React.ReactNode) => <div style={{ minHeight: 560 }}>{node}</div>;
export const Open: StoryObj = { render: () => box(<CommandPalette open onClose={() => {}} actions={actions} />) };
export const Loading: StoryObj = { render: () => box(<CommandPalette open onClose={() => {}} actions={[]} loading />) };
export const Empty: StoryObj = { render: () => box(<CommandPalette open onClose={() => {}} actions={[]} />) };

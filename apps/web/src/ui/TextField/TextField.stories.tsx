import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search } from 'lucide-react';
import { TextField } from '.';

const meta: Meta<typeof TextField> = { title: 'Input/TextField', component: TextField };
export default meta;
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 640 }}>
      <TextField label="Project name" placeholder="Lakeview Residence" helper="Shown on invoices" />
      <TextField label="Project name" defaultValue="Lakeview Residence" />
      <TextField label="Project code" defaultValue="PRJ-01" error="This code is already in use" mono />
      <TextField label="Client" defaultValue="Lakeview Trust" disabled />
      <TextField label="Contract" defaultValue="Fixed fee" readOnly />
      <TextField label="Search people" prefix={<Search size={16} strokeWidth={1.5} aria-hidden />} suffix="Ctrl K" dense placeholder="Vikram Nair" />
    </div>
  ),
};

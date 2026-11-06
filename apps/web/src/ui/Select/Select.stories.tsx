import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Select } from '.';

const meta: Meta<typeof Select> = { title: 'Input/Select', component: Select };
export default meta;
const TYPES = ['Full time', 'Part time', 'Intern', 'Consultant'].map((t) => ({ value: t, label: t }));
function Live() {
  const [v, set] = useState<string | null>('Part time');
  return <Select label="Employment type" options={TYPES} value={v} onChange={set} helper="Sneha works 4 days" searchable />;
}
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 560 }}>
      <Live />
      <Select label="Employment type" options={TYPES} value={null} error="Select a type" />
      <Select label="Employment type" options={TYPES} value="Intern" disabled />
      <Select label="Employment type" options={TYPES} value="Intern" readOnly />
    </div>
  ),
};
export const Open: StoryObj = { render: () => <div style={{ height: 240, maxWidth: 280 }}><Select defaultOpen label="Employment type" options={TYPES} value="Intern" /></div> };

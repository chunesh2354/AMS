import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MultiSelect } from '.';

const meta: Meta<typeof MultiSelect> = { title: 'Input/MultiSelect', component: MultiSelect };
export default meta;
const SKILLS = ['Revit', 'Rhino', 'Site supervision', 'Detailing', 'Visualisation'].map((s) => ({ value: s, label: s }));
function Live() {
  const [v, set] = useState<string[]>(['Revit', 'Detailing']);
  return <MultiSelect label="Skills" options={SKILLS} value={v} onChange={set} helper="Backspace removes the last one" />;
}
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 640 }}>
      <Live />
      <MultiSelect label="Skills" options={SKILLS} value={[]} error="Add at least one skill" />
      <MultiSelect label="Skills" options={SKILLS} value={['Rhino']} disabled />
      <MultiSelect label="Skills" options={SKILLS} value={['Rhino']} readOnly />
    </div>
  ),
};
export const Open: StoryObj = { render: () => <div style={{ height: 280, maxWidth: 320 }}><MultiSelect defaultOpen label="Skills" options={SKILLS} value={['Revit']} /></div> };

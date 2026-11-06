import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DurationField } from '.';

const meta: Meta<typeof DurationField> = { title: 'Input/DurationField', component: DurationField };
export default meta;
function Live() {
  const [m, set] = useState<number | null>(390);
  return <DurationField label="Duration" minutes={m} onChange={set} helper="Type 6:30 or 6.5" />;
}
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 480 }}>
      <Live />
      <DurationField label="Duration" minutes={750} error="Over 12 h needs a note" />
      <DurationField label="Duration" minutes={120} disabled />
      <DurationField label="Duration" minutes={120} readOnly />
    </div>
  ),
};

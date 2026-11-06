import type { Meta, StoryObj } from '@storybook/react-vite';
import { PercentField } from '.';

const meta: Meta<typeof PercentField> = { title: 'Input/PercentField', component: PercentField };
export default meta;
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 480 }}>
      <PercentField label="Markup" defaultValue="10" helper="Applied to the consultant bill" />
      <PercentField label="Fee" defaultValue="106" error="Must be 100 or less" />
      <PercentField label="Fee" defaultValue="6" disabled />
      <PercentField label="Fee" defaultValue="6" readOnly />
    </div>
  ),
};

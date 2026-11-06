import type { Meta, StoryObj } from '@storybook/react-vite';
import { NumberField } from '.';

const meta: Meta<typeof NumberField> = { title: 'Input/NumberField', component: NumberField };
export default meta;
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 480 }}>
      <NumberField label="Budget (h)" defaultValue="200" helper="Baseline hours" />
      <NumberField label="ETC (h)" defaultValue="-4" error="Must be zero or more" />
      <NumberField label="Budget (h)" defaultValue="200" disabled />
      <NumberField label="Budget (h)" defaultValue="200" readOnly />
    </div>
  ),
};

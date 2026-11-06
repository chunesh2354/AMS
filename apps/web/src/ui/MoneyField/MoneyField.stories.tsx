import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MoneyField } from '.';

const meta: Meta<typeof MoneyField> = { title: 'Input/MoneyField', component: MoneyField };
export default meta;
function Live() {
  const [v, set] = useState<number | null>(240000);
  return <MoneyField label="Fee component" value={v} onChange={set} helper="Fixed fee" />;
}
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 480 }}>
      <Live />
      <MoneyField label="Consultant bill" value={250000} error="Exceeds the approved amount" />
      <MoneyField label="Fixed fee" value={2400000} disabled />
      <MoneyField label="Fixed fee" value={2400000} readOnly />
    </div>
  ),
};

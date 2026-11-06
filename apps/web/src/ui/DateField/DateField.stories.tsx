import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DateField } from '.';

const meta: Meta<typeof DateField> = { title: 'Input/DateField', component: DateField };
export default meta;
function Live() {
  const [v, set] = useState<string | null>('2026-11-06');
  return <DateField label="Date" value={v} onChange={set} today="2026-11-06" holidays={['2026-11-09', '2026-11-10']} helper="Holidays are shaded" />;
}
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 560 }}>
      <Live />
      <DateField label="Next milestone" value={null} />
      <DateField label="Due" value="2026-10-02" error="Due date is before the phase start" />
      <DateField label="Start" value="2026-04-01" disabled />
      <DateField label="Start" value="2026-04-01" readOnly />
    </div>
  ),
};
export const CalendarOpen: StoryObj = {
  render: () => (
    <div style={{ height: 400, maxWidth: 280 }}>
      <DateField defaultOpen label="Date" value="2026-11-06" today="2026-11-06" min="2026-11-02" holidays={['2026-11-09', '2026-11-10']} />
    </div>
  ),
};

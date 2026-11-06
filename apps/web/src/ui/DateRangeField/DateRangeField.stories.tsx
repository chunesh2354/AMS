import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DateRangeField, type DateRange } from '.';

const meta: Meta<typeof DateRangeField> = { title: 'Input/DateRangeField', component: DateRangeField };
export default meta;
function Live() {
  const [v, set] = useState<DateRange>({ from: '2026-11-16', to: '2026-11-17' });
  return <DateRangeField label="Leave dates" value={v} onChange={set} today="2026-11-06" helper="Two-day request" />;
}
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 640 }}>
      <Live />
      <DateRangeField label="Delegate" value={{ from: null, to: null }} />
      <DateRangeField label="Leave dates" value={{ from: '2026-11-16', to: '2026-11-17' }} error="Overlaps an approved request" />
      <DateRangeField label="Leave dates" value={{ from: '2026-11-16', to: '2026-11-17' }} disabled />
    </div>
  ),
};
export const CalendarOpen: StoryObj = {
  render: () => (
    <div style={{ height: 400, maxWidth: 320 }}>
      <DateRangeField defaultOpen label="Leave dates" value={{ from: '2026-11-16', to: '2026-11-20' }} today="2026-11-06" />
    </div>
  ),
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import { AvailabilityBar, AvailabilityLegend } from '.';
import { AVAILABILITY } from '../../mock/studio-meridian';

const meta: Meta<typeof AvailabilityBar> = { title: 'Planning/AvailabilityBar', component: AvailabilityBar };
export default meta;
export const DivyaMenon: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
      {AVAILABILITY.P05.map((w) => <AvailabilityBar key={w.week} label={w.week} {...w} />)}
      <AvailabilityLegend />
    </div>
  ),
};

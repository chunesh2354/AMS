import type { Meta, StoryObj } from '@storybook/react-vite';
import { DayTotalRing } from '.';

const meta: Meta<typeof DayTotalRing> = { title: 'Planning/DayTotalRing', component: DayTotalRing };
export default meta;
export const States: StoryObj = {
  render: () => <div style={{ display: 'flex', gap: 16 }}><DayTotalRing hours={0} scheduled={8} /><DayTotalRing hours={3} scheduled={8} /><DayTotalRing hours={8} scheduled={8} /><DayTotalRing hours={12.5} scheduled={8} label="Thursday" /></div>,
};

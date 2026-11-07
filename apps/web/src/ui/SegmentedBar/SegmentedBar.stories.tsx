import type { Meta, StoryObj } from '@storybook/react-vite';
import { SegmentedBar } from '.';

const meta: Meta<typeof SegmentedBar> = { title: 'Data display/SegmentedBar', component: SegmentedBar };
export default meta;
export const Ageing: StoryObj = {
  render: () => <SegmentedBar label="Ageing" segments={[{ label: 'Current', value: 0, display: '₹0', color: 'ok' }, { label: '30 d', value: 160000, display: '₹1,60,000', color: 'warn' }, { label: '60 d', value: 0, display: '₹0', color: 'danger' }, { label: '90+ d', value: 0, display: '₹0', color: 'neutral' }]} />,
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import { CompareColumns } from '.';

const meta: Meta<typeof CompareColumns> = { title: 'Data display/CompareColumns', component: CompareColumns };
export default meta;
export const Budget: StoryObj = { render: () => <CompareColumns label="Budget" columns={[{ label: 'Baseline', value: '200', unit: 'h' }, { label: 'Revised', value: '200', unit: 'h' }, { label: 'Forecast', value: '230', unit: 'h', danger: true }]} /> };
export const Bills: StoryObj = {
  render: () => <CompareColumns label="Bills" columns={[{ label: 'Bill 1', rows: [{ label: 'Vendor', value: 'Structural consultant' }, { label: 'Amount', value: '₹2,50,000' }] }, { label: 'Bill 2', rows: [{ label: 'Vendor', value: 'Structural consultant' }, { label: 'Amount', value: '₹2,50,000' }] }]} />,
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import { MiniChart } from '.';
import { formatINR } from '../format';

const meta: Meta<typeof MiniChart> = { title: 'Data display/MiniChart', component: MiniChart };
export default meta;
const box = (S: () => React.JSX.Element) => <div className="glass" style={{ padding: 20, maxWidth: 360 }}><S /></div>;
const WEEKS = [32, 36, 38, 30, 40, 38.5, 34, 36].map((value, i) => ({ label: `Week ${i + 1}`, value, display: `${value.toFixed(2)} h` }));
export const Bar: StoryObj<typeof MiniChart> = { decorators: [box], args: { kind: 'bar', label: 'Hours per week', data: WEEKS } };
export const Line: StoryObj<typeof MiniChart> = { decorators: [box], args: { kind: 'line', label: 'Hours trend', data: WEEKS } };
export const Ageing: StoryObj<typeof MiniChart> = {
  decorators: [box],
  args: {
    kind: 'donut', label: 'Receivables ageing',
    data: [
      { label: 'Current', value: 240000, color: 'ok', display: formatINR(240000) },
      { label: '30 d', value: 160000, color: 'warn', display: formatINR(160000) },
      { label: '60 d', value: 0, color: 'danger', display: formatINR(0) },
      { label: '90+ d', value: 0, color: 'neutral', display: formatINR(0) },
    ],
  },
};

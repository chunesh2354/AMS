import type { Meta, StoryObj } from '@storybook/react-vite';
import { IncompleteIndicator } from '.';

const meta: Meta<typeof IncompleteIndicator> = { title: 'Data display/IncompleteIndicator', component: IncompleteIndicator };
export default meta;
export const Default: StoryObj = {
  render: () => <IncompleteIndicator missing={['Nisha Kumar cost rate']}><span className="t-kpi">72%</span></IncompleteIndicator>,
};

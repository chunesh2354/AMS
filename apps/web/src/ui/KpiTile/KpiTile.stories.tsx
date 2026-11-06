import type { Meta, StoryObj } from '@storybook/react-vite';
import { KpiTile } from '.';
import { formatINR } from '../format';

const meta: Meta<typeof KpiTile> = { title: 'Data display/KpiTile', component: KpiTile };
export default meta;
export const States: StoryObj = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(4, 1fr)', padding: 32 }}>
      <KpiTile label="Ready to bill" value={formatINR(486000)} delta={{ text: '+₹80,000 this week', direction: 'up' }} />
      <KpiTile label="Hours" value="820" unit="/ 1,100 h" />
      <KpiTile label="Utilization" value="72%" complete={false} missing={['Nisha Kumar cost rate']} />
      <KpiTile label="Contribution" restricted />
    </div>
  ),
};

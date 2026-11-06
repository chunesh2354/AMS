import type { Meta, StoryObj } from '@storybook/react-vite';
import { Toggle } from '.';

const meta: Meta<typeof Toggle> = { title: 'Input/Toggle', component: Toggle };
export default meta;
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Toggle label="Billable" description="Counts toward fee utilisation" />
      <Toggle label="Billable" defaultChecked />
      <Toggle label="Billable" disabled />
      <Toggle label="Billable" disabled defaultChecked />
    </div>
  ),
};

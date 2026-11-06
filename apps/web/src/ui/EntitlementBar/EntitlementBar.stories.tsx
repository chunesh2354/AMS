import type { Meta, StoryObj } from '@storybook/react-vite';
import { EntitlementBar } from '.';

const meta: Meta<typeof EntitlementBar> = { title: 'Data display/EntitlementBar', component: EntitlementBar };
export default meta;
export const Lakeview: StoryObj<typeof EntitlementBar> = {
  decorators: [(S) => <div style={{ maxWidth: 640 }}><S /></div>],
  args: { contracted: 2400000, entitled: 1120000, drafted: 800000, invoiced: 560000, collected: 400000 },
};

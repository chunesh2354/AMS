import type { Meta, StoryObj } from '@storybook/react-vite';
import { Checkbox } from '.';

const meta: Meta<typeof Checkbox> = { title: 'Input/Checkbox', component: Checkbox };
export default meta;
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Checkbox label="Payable" description="Pay the consultant on approval" />
      <Checkbox label="Recharge to client" checked readOnly />
      <Checkbox label="Select all" indeterminate readOnly />
      <Checkbox label="Disabled" disabled />
      <Checkbox label="Disabled, checked" disabled checked readOnly />
    </div>
  ),
};

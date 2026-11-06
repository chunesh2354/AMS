import type { Meta, StoryObj } from '@storybook/react-vite';
import { Radio } from '.';

const meta: Meta<typeof Radio> = { title: 'Input/Radio', component: Radio };
export default meta;
export const States: StoryObj = {
  render: () => (
    <div role="radiogroup" aria-label="Leave unit" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Radio name="u" label="Full day" description="8 hours" defaultChecked />
      <Radio name="u" label="Half day" />
      <Radio name="u" label="Hours" disabled />
    </div>
  ),
};

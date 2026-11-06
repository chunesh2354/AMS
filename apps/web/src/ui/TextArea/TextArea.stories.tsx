import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextArea } from '.';

const meta: Meta<typeof TextArea> = { title: 'Input/TextArea', component: TextArea };
export default meta;
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 640 }}>
      <TextArea label="Handover note" placeholder="Who picks up Concept design" helper="Visible to your manager" />
      <TextArea label="Return reason" defaultValue="wrong phase" />
      <TextArea label="Return reason" error="A reason is required" />
      <TextArea label="Scope" defaultValue="Accepted scope is locked" readOnly />
      <TextArea label="Scope" defaultValue="Not editable" disabled />
    </div>
  ),
};

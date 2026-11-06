import type { Meta, StoryObj } from '@storybook/react-vite';
import { InlineAlert } from '.';

const meta: Meta<typeof InlineAlert> = { title: 'Feedback/InlineAlert', component: InlineAlert };
export default meta;
export const Variants: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560 }}>
      <InlineAlert variant="success" title="Draft approved">Ready to submit to accounting.</InlineAlert>
      <InlineAlert variant="warn" title="Possible duplicate" links={[{ label: 'Compare bills', href: '#compare' }]} dismissible>This ₹2,50,000 bill matches one from the same consultant.</InlineAlert>
      <InlineAlert variant="danger" title="Over the NTE limit">Excess ₹2,000 is not eligible for billing.</InlineAlert>
      <InlineAlert variant="info" title="PRJ-03 is on hold">Allocations are retained until the hold is lifted.</InlineAlert>
    </div>
  ),
};

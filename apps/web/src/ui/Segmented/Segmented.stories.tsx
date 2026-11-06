import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Segmented } from '.';

const meta: Meta = { title: 'Input/Segmented' };
export default meta;
function Demo({ opts }: { opts: string[] }) {
  const [v, set] = useState(opts[0]);
  return <Segmented label="View" options={opts.map((o) => ({ value: o, label: o }))} value={v} onChange={set} />;
}
export const Sizes: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
      <Demo opts={['Week', 'Day']} />
      <Demo opts={['Cash', 'Withholding', 'Credit']} />
      <Demo opts={['Active', 'Invited', 'Pending', 'Deactivated']} />
    </div>
  ),
};

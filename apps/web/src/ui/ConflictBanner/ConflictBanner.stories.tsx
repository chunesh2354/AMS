import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ConflictBanner } from '.';

const meta: Meta<typeof ConflictBanner> = { title: 'Data display/ConflictBanner', component: ConflictBanner };
export default meta;
function Live() {
  const [r, set] = useState('');
  return <ConflictBanner kind="overallocated" hoursOver={2} detail="Divya Menon: 40 h scheduled, 8 holiday, 4 leave, 4 commitment, 26 allocated." reason={r} onReasonChange={set} reasonError={r ? undefined : 'A reason is required'} />;
}
export const Kinds: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
      <Live />
      <ConflictBanner kind="unavailable" hoursOver={8} detail="On approved leave." />
      <ConflictBanner kind="outside employment" hoursOver={16} detail="Allocation starts before the joining date." />
    </div>
  ),
};

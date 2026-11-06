import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusChip } from '.';
import { STATUS_GROUPS, type Status, type Tone } from '../status-colors';

const meta: Meta<typeof StatusChip> = { title: 'Data display/StatusChip', component: StatusChip };
export default meta;
export const EveryStatus: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {(Object.keys(STATUS_GROUPS) as Tone[]).map((t) => (
        <div key={t} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(STATUS_GROUPS[t] as readonly Status[]).map((s) => <StatusChip key={s} status={s} />)}
        </div>
      ))}
    </div>
  ),
};
export const SizesAndDot: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <StatusChip status="Approved" /><StatusChip status="Approved" size="sm" /><StatusChip status="Overrun" dot /><StatusChip status="Approved" dot />
    </div>
  ),
};

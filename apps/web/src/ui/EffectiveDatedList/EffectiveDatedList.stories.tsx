import type { Meta, StoryObj } from '@storybook/react-vite';
import { EffectiveDatedList } from '.';

const meta: Meta<typeof EffectiveDatedList> = { title: 'Data display/EffectiveDatedList', component: EffectiveDatedList };
export default meta;
export const Capacity: StoryObj<typeof EffectiveDatedList> = {
  args: {
    current: 1,
    versions: [
      { from: '2025-04-01', to: '2026-03-31', label: '5 days, 40 h', detail: 'Joined as Architect' },
      { from: '2026-04-01', to: '2026-12-31', label: '5 days, 40 h', detail: 'Current working pattern' },
      { from: '2027-01-01', to: null, label: '4 days, 32 h', detail: 'Approved part-time change' },
    ],
  },
};

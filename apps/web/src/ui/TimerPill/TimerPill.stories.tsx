import type { Meta, StoryObj } from '@storybook/react-vite';
import { TimerPill } from '.';

const meta: Meta<typeof TimerPill> = { title: 'Planning/TimerPill', component: TimerPill };
export default meta;
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <TimerPill state="idle" />
      <TimerPill state="running" elapsedSeconds={6120} context="PRJ-01 · Concept design" />
      <TimerPill state="running" elapsedSeconds={36600} context="PRJ-01 · Concept design" />
    </div>
  ),
};

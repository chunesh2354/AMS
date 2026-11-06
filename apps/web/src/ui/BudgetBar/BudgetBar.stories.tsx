import type { Meta, StoryObj } from '@storybook/react-vite';
import { BudgetBar } from '.';

const meta: Meta<typeof BudgetBar> = { title: 'Data display/BudgetBar', component: BudgetBar };
export default meta;
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 420 }}>
      <BudgetBar baseline={200} actual={170} forecast={230} />
      <BudgetBar baseline={1100} actual={820} forecast={1050} />
      <BudgetBar baseline={200} revised={240} actual={170} forecast={230} showCost costActual={340000} costBudget={480000} />
      <BudgetBar baseline={200} actual={170} forecast={230} showCost costRestricted />
      <div style={{ width: 120 }}><BudgetBar mini baseline={200} actual={170} forecast={230} /></div>
    </div>
  ),
};

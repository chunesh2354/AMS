import type { Meta, StoryObj } from '@storybook/react-vite';
import { Plus } from 'lucide-react';
import { Button } from '.';

const meta: Meta<typeof Button> = { title: 'Input/Button', component: Button };
export default meta;
const VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const;
export const All: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(5, max-content)', alignItems: 'center' }}>
      {VARIANTS.map((v) => [
        <Button key={v} variant={v}>Approve</Button>,
        <Button key={`${v}i`} variant={v} icon={<Plus size={20} strokeWidth={1.5} aria-hidden />}>Add person</Button>,
        <Button key={`${v}d`} variant={v} size="dense">Dense</Button>,
        <Button key={`${v}l`} variant={v} loading>Saving</Button>,
        <Button key={`${v}x`} variant={v} disabled>Disabled</Button>,
      ])}
      <Button variant="primary" size="cta">Generate billing draft</Button>
    </div>
  ),
};

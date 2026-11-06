import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileDrop } from '.';

const meta: Meta<typeof FileDrop> = { title: 'Input/FileDrop', component: FileDrop };
export default meta;
const box = { display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 720 };
export const States: StoryObj = {
  render: () => (
    <div style={box}>
      <FileDrop label="Receipt" accept="image/*,.pdf" />
      <FileDrop label="Receipt" dragover />
      <FileDrop label="Receipt" progress={62} files={[{ name: 'taxi-receipt.jpg' }]} />
      <FileDrop label="Receipt" error="That file is over 10 MB" />
    </div>
  ),
};

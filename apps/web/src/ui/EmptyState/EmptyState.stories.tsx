import type { Meta, StoryObj } from '@storybook/react-vite';
import { Users } from 'lucide-react';
import { EmptyState } from '.';
import { Button } from '../Button';

const meta: Meta<typeof EmptyState> = { title: 'Feedback/EmptyState', component: EmptyState };
export default meta;
export const Default: StoryObj = {
  render: () => <EmptyState icon={<Users size={20} strokeWidth={1.5} aria-hidden />} message="No one has been invited yet." action={<Button variant="primary">Add person</Button>} />,
};

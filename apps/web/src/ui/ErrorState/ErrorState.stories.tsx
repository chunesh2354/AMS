import type { Meta, StoryObj } from '@storybook/react-vite';
import { ErrorState } from '.';

const meta: Meta<typeof ErrorState> = { title: 'Feedback/ErrorState', component: ErrorState };
export default meta;
export const Default: StoryObj<typeof ErrorState> = { args: { message: 'The time entries could not be loaded.', onRetry: () => {} } };

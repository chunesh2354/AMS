import type { Meta, StoryObj } from '@storybook/react-vite';
import { RestrictedCell } from '.';

const meta: Meta<typeof RestrictedCell> = { title: 'Data display/RestrictedCell', component: RestrictedCell };
export default meta;
export const Default: StoryObj<typeof RestrictedCell> = {};
export const CustomReason: StoryObj<typeof RestrictedCell> = { args: { reason: 'Requires principal permission' } };

import type { Meta, StoryObj } from '@storybook/react-vite';
import { PermissionDenied } from '.';

const meta: Meta<typeof PermissionDenied> = { title: 'Feedback/PermissionDenied', component: PermissionDenied };
export default meta;
export const Default: StoryObj<typeof PermissionDenied> = { args: { capability: 'view billing' } };

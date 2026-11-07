import type { Meta, StoryObj } from '@storybook/react-vite';
import { Stepper } from '.';

const meta: Meta<typeof Stepper> = { title: 'Input/Stepper', component: Stepper };
export default meta;
export const Middle: StoryObj<typeof Stepper> = { args: { steps: ['Details', 'Access', 'Capacity', 'Review'], current: 1 } };
export const Last: StoryObj<typeof Stepper> = { args: { steps: ['Details', 'Access', 'Capacity', 'Review'], current: 3 } };

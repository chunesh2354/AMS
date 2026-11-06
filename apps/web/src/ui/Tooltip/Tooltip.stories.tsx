import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tooltip } from '.';

const meta: Meta<typeof Tooltip> = { title: 'Feedback/Tooltip', component: Tooltip, parameters: { layout: 'centered' } };
export default meta;
export const Top: StoryObj<typeof Tooltip> = { args: { text: 'Requires finance permission', defaultOpen: true, children: <button className="btn btn--secondary">Contribution</button> } };
export const Right: StoryObj<typeof Tooltip> = { args: { ...Top.args, side: 'right' } };

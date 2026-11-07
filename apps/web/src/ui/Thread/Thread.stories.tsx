import type { Meta, StoryObj } from '@storybook/react-vite';
import { Thread } from '.';

const meta: Meta<typeof Thread> = { title: 'Approval/Thread', component: Thread };
export default meta;
const messages = [
  { id: '1', author: 'Vikram Nair', text: 'Check the landing level against the revised section.', time: '14:30' },
  { id: '2', author: 'Rohan Shetty', text: 'Updated in v2, waiting on structure to confirm.', time: '15:10' },
];
export const Default: StoryObj = { render: () => <div style={{ maxWidth: 560 }}><Thread label="Review thread" messages={messages} onReply={() => {}} /></div> };
export const Empty: StoryObj = { render: () => <div style={{ maxWidth: 560 }}><Thread label="Review thread" messages={[]} onReply={() => {}} /></div> };

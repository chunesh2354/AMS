import type { Meta, StoryObj } from '@storybook/react-vite';
import { ListStateBlock } from '.';
import { Button } from '../Button';

const meta: Meta<typeof ListStateBlock> = { title: 'Feedback/ListState', component: ListStateBlock };
export default meta;
export const Loading: StoryObj = { render: () => <ListStateBlock state="loading" label="Approvals" /> };
export const Empty: StoryObj = { render: () => <ListStateBlock state="empty" label="Approvals" empty={{ message: 'Nothing is waiting for you.', action: <Button variant="primary">See approved items</Button> }} /> };
export const Error: StoryObj = { render: () => <ListStateBlock state="error" label="Approvals" onRetry={() => {}} /> };
export const Denied: StoryObj = { render: () => <ListStateBlock state="denied" label="Approvals" capability="approve time" /> };

import type { Meta, StoryObj } from '@storybook/react-vite';
import { Skeleton } from '.';

const meta: Meta<typeof Skeleton> = { title: 'Feedback/Skeleton', component: Skeleton };
export default meta;
export const Text: StoryObj = { render: () => <div className="skeleton-stack" style={{ maxWidth: 320 }}><Skeleton width="80%" /><Skeleton width="60%" /></div> };
export const Card: StoryObj = { render: () => <div style={{ maxWidth: 240 }}><Skeleton kind="card" /></div> };
export const Table: StoryObj = { args: { kind: 'table' } };
export const Planner: StoryObj = { args: { kind: 'planner' } };

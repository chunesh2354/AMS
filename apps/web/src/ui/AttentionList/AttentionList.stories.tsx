import type { Meta, StoryObj } from '@storybook/react-vite';
import { AttentionList } from '.';
import { ATTENTION } from '../../mock/studio-meridian';

const meta: Meta<typeof AttentionList> = { title: 'Data display/AttentionList', component: AttentionList };
export default meta;
const box = (node: React.ReactNode) => <div style={{ maxWidth: 680 }}>{node}</div>;
export const StudioMeridian: StoryObj = { render: () => box(<AttentionList items={ATTENTION} />) };
export const Loading: StoryObj = { render: () => box(<AttentionList items={[]} state="loading" />) };
export const Empty: StoryObj = { render: () => box(<AttentionList items={[]} />) };
export const Error: StoryObj = { render: () => box(<AttentionList items={[]} state="error" onRetry={() => {}} />) };
export const Denied: StoryObj = { render: () => box(<AttentionList items={[]} state="denied" capability="view firm attention items" />) };

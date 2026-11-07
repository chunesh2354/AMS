import type { Meta, StoryObj } from '@storybook/react-vite';
import { ApprovalRow } from '.';
import { APPROVALS } from '../../mock/studio-meridian';

const meta: Meta<typeof ApprovalRow> = { title: 'Approval/ApprovalRow', component: ApprovalRow };
export default meta;
const box = { maxWidth: 720, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', listStyle: 'none', margin: 0, padding: 0 };
export const States: StoryObj = {
  render: () => (
    <ul style={box}>
      <ApprovalRow item={APPROVALS[0]} />
      <ApprovalRow item={APPROVALS[1]} selected />
      <ApprovalRow item={APPROVALS[2]} active />
      <ApprovalRow item={APPROVALS[10]} defaultReturning />
    </ul>
  ),
};

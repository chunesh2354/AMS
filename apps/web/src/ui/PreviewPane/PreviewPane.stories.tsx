import type { Meta, StoryObj } from '@storybook/react-vite';
import { PreviewPane } from '.';
import { Button } from '../Button';
import { InlineAlert } from '../InlineAlert';
import { APPROVALS } from '../../mock/studio-meridian';

const meta: Meta<typeof PreviewPane> = { title: 'Approval/PreviewPane', component: PreviewPane };
export default meta;
const box = (node: React.ReactNode) => <div style={{ maxWidth: 400 }}>{node}</div>;
const a = APPROVALS[0];
export const Ready: StoryObj = {
  render: () => box(
    <PreviewPane
      eyebrow={a.type} title={a.submitter}
      fields={[{ label: 'Project', value: a.project }, { label: 'Hours', value: a.amount, mono: true }, { label: 'Approver', value: a.approver }]}
      alert={<InlineAlert variant="warn" title="Exception: over 12 h day">Thursday has 12.50 h.</InlineAlert>}
      evidence={a.evidence} history={a.history}
      actions={<><Button variant="primary">Approve</Button><Button>Return</Button></>}
    />,
  ),
};
export const Loading: StoryObj = { render: () => box(<PreviewPane state="loading" />) };
export const Empty: StoryObj = { render: () => box(<PreviewPane state="empty" />) };

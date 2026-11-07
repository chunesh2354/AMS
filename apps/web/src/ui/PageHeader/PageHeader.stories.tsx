import type { Meta, StoryObj } from '@storybook/react-vite';
import { PageHeader } from '.';
import { Button } from '../Button';
import { StatusChip } from '../StatusChip';

const meta: Meta<typeof PageHeader> = { title: 'Shell/PageHeader', component: PageHeader, parameters: { layout: 'padded' } };
export default meta;
export const Display: StoryObj = { render: () => <PageHeader display title="Good afternoon, Asha" meta={<span className="t-numeric ink-2">06 Nov 2026</span>} /> };
export const WithActions: StoryObj = { render: () => <PageHeader title="People" meta={<span className="t-numeric ink-2">10 people</span>} secondaryActions={<Button>Import</Button>} primaryAction={<Button variant="primary">Add person</Button>} /> };
export const Workspace: StoryObj = {
  parameters: { route: '/firm/projects/PRJ-01/phases' },
  render: () => (
    <PageHeader
      title="Lakeview Residence"
      breadcrumb={[{ label: 'Projects', to: '/firm/projects' }, { label: 'PRJ-01' }]}
      meta={<><StatusChip status="Active" size="sm" /><StatusChip status="Overrun" size="sm" /></>}
      primaryAction={<Button variant="primary">Generate billing draft</Button>}
      tabs={[{ label: 'Overview', to: '/firm/projects/PRJ-01', end: true }, { label: 'Phases', to: '/firm/projects/PRJ-01/phases' }, { label: 'Tasks', to: '/firm/projects/PRJ-01/tasks' }]}
    />
  ),
};

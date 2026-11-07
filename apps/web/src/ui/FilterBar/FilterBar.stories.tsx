import type { Meta, StoryObj } from '@storybook/react-vite';
import { useSearchParams } from 'react-router-dom';
import { FilterBar, type FilterDef } from '.';

const meta: Meta<typeof FilterBar> = { title: 'Data display/FilterBar', component: FilterBar };
export default meta;
const FILTERS: FilterDef[] = [
  { type: 'search', key: 'q', label: 'Search people' },
  { type: 'select', key: 'pm', label: 'PM', options: [{ value: 'P02', label: 'Vikram Nair' }, { value: 'P03', label: 'Meera Iyer' }] },
  { type: 'multi', key: 'status', label: 'Status', options: [{ value: 'active', label: 'Active' }, { value: 'hold', label: 'On hold' }] },
  { type: 'dateRange', key: 'due', label: 'Due' },
];
function Url() {
  const [p] = useSearchParams();
  return <p className="t-caption ink-2" style={{ marginTop: 12 }}>URL params: <code>{p.toString() || 'none'}</code></p>;
}
const views = [{ name: 'My projects on hold', params: { pm: 'P02', status: 'hold' } }];
export const Idle: StoryObj = { render: () => <><FilterBar filters={FILTERS} savedViews={views} /><Url /></> };
export const Active: StoryObj = {
  parameters: { route: '/?pm=P02&status=active,hold&due=2026-11-01..2026-11-30' },
  render: () => <><FilterBar filters={FILTERS} savedViews={views} /><Url /></>,
};

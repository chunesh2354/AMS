import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Check, CornerUpLeft } from 'lucide-react';
import { DataTable, RESTRICTED, type Column } from '.';
import { Button } from '../Button';
import type { Status } from '../status-colors';

const meta: Meta = { title: 'Data display/DataTable', parameters: { layout: 'padded' } };
export default meta;

type Phase = { id: string; project: string; phase: string; owner: string; budget: number; actual: number; etc: number; fee: number | typeof RESTRICTED; due: string; status: Status };
const ROWS: Phase[] = [
  { id: '1', project: 'PRJ-01 Lakeview Residence', phase: 'Concept design', owner: 'Rohan Shetty', budget: 120, actual: 118, etc: 0, fee: 240000, due: '2026-04-10', status: 'Done' },
  { id: '2', project: 'PRJ-01 Lakeview Residence', phase: 'Working drawings', owner: 'Vikram Nair', budget: 200, actual: 170, etc: 60, fee: 600000, due: '2026-12-18', status: 'Overrun' },
  { id: '3', project: 'PRJ-02 Orchard Commercial Block', phase: 'Schematic design', owner: 'Meera Iyer', budget: 320, actual: 150, etc: 170, fee: RESTRICTED, due: '2026-12-04', status: 'In progress' },
  { id: '4', project: 'PRJ-03 Heritage Cafe Refit', phase: 'Design development', owner: 'Vikram Nair', budget: 80, actual: 22, etc: 58, fee: 180000, due: '2027-01-15', status: 'On hold' },
];
const columns: Column<Phase>[] = [
  { key: 'phase', header: 'Phase', value: (r) => r.phase, sortable: true },
  { key: 'owner', header: 'Owner', type: 'person', value: (r) => r.owner, sortable: true },
  { key: 'budget', header: 'Budget (h)', type: 'hours', value: (r) => r.budget, sortable: true, total: (rows) => rows.reduce((s, r) => s + r.budget, 0) },
  { key: 'actual', header: 'Actual (h)', type: 'hours', value: (r) => r.actual, sortable: true, total: (rows) => rows.reduce((s, r) => s + r.actual, 0) },
  { key: 'etc', header: 'ETC (h)', type: 'hours', value: (r) => r.etc, hiddenByDefault: true },
  { key: 'fee', header: 'Fee allocation (₹)', type: 'money', value: (r) => r.fee },
  { key: 'due', header: 'Due', type: 'date', value: (r) => r.due, sortable: true },
  { key: 'status', header: 'Status', type: 'status', value: (r) => r.status },
];
const base = { label: 'Phases', columns, rows: ROWS, rowKey: (r: Phase) => r.id };

export const Comfortable: StoryObj = { render: () => <DataTable {...base} columnPicker /> };
export const Dense: StoryObj = { render: () => <DataTable {...base} density="dense" /> };
export const Grouped: StoryObj = { render: () => <DataTable {...base} groupBy={(r) => r.project} /> };
function Selecting() {
  const [selected, setSelected] = useState(['1']);
  return <DataTable {...base} selection={{ selected, onChange: setSelected, isSelectable: (r) => r.status !== 'Overrun' }} rowActions={() => [{ label: 'Approve', icon: <Check size={16} strokeWidth={1.5} aria-hidden /> }, { label: 'Return', icon: <CornerUpLeft size={16} strokeWidth={1.5} aria-hidden /> }]} />;
}
export const SelectionAndActions: StoryObj = { render: () => <Selecting /> };
function Editing() {
  const [rows, setRows] = useState(ROWS);
  const cols: Column<Phase>[] = [columns[0], { ...columns[2], total: undefined, onEdit: (r, v) => setRows((l) => l.map((x) => (x.id === r.id ? { ...x, budget: Number(v) || x.budget } : x))) }];
  return <DataTable {...base} columns={cols} rows={rows} />;
}
export const InlineEdit: StoryObj = { render: () => <Editing /> };
export const Loading: StoryObj = { render: () => <DataTable {...base} state="loading" /> };
export const Empty: StoryObj = { render: () => <DataTable {...base} rows={[]} empty={{ message: 'No phases have been added to this project.', action: <Button variant="primary">Add phase</Button> }} /> };
export const Error: StoryObj = { render: () => <DataTable {...base} state="error" onRetry={() => {}} /> };
export const PermissionDenied: StoryObj = { render: () => <DataTable {...base} state="denied" capability="view phase budgets" /> };

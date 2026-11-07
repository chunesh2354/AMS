import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlannerGrid, PlannerLegend, type PlannerAllocation, type PlannerRow } from '.';
import { Skeleton } from '../Skeleton';

const meta: Meta<typeof PlannerGrid> = { title: 'Planning/PlannerGrid', component: PlannerGrid };
export default meta;
const columns = ['02 Nov', '09 Nov', '16 Nov', '23 Nov', '30 Nov', '07 Dec'].map((label, i) => ({ key: label, label, today: i === 0, note: i === 0 ? 'Today' : undefined }));
const rows: PlannerRow[] = [
  { id: 'un', label: 'Unassigned demand', pinned: true },
  { id: 'P05', label: 'Divya Menon', avatar: true, group: 'PRJ-01 Lakeview Residence' },
  { id: 'P04', label: 'Rohan Shetty', avatar: true, group: 'PRJ-01 Lakeview Residence' },
  { id: 'P02', label: 'Vikram Nair', avatar: true, group: 'PRJ-03 Heritage Cafe Refit', groupStatus: 'On hold' },
];
const start: PlannerAllocation[] = [
  { id: 'u', rowId: 'un', column: 0, hours: 5, label: 'PRJ-01 Concept', kind: 'tentative' },
  { id: 'a', rowId: 'P05', column: 1, hours: 24, label: 'Working drawings', kind: 'confirmed', published: true },
  { id: 'b', rowId: 'P05', column: 2, hours: 26, label: 'Working drawings', kind: 'confirmed' },
  { id: 'c', rowId: 'P04', column: 0, hours: 16, label: 'Concept design', kind: 'confirmed', published: true },
  { id: 'd', rowId: 'P04', column: 0, hours: 12, label: 'Working drawings', kind: 'confirmed', published: true },
  { id: 'e', rowId: 'P04', column: 4, hours: 16, label: 'Tender', kind: 'tentative' },
  { id: 'f', rowId: 'P02', column: 0, hours: 8, label: 'Retained', kind: 'hold', published: true },
];
function Live() {
  const [items, set] = useState(start);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ height: 420, display: 'flex' }}>
        <PlannerGrid
          label="Resource planner" columns={columns} rows={rows} allocations={items}
          off={[{ rowId: 'P04', column: 2, label: 'Leave' }]} over={(r, c) => (r === 'P05' && c === 2 ? 2 : 0)}
          onMove={(id, rowId, column) => set((l) => l.map((a) => (a.id === id ? { ...a, rowId, column } : a)))}
          onResize={(id, hours) => set((l) => l.map((a) => (a.id === id ? { ...a, hours } : a)))}
        />
      </div>
      <PlannerLegend hint="Arrow keys move. Shift + arrow moves an allocation. + and − change hours." />
    </div>
  );
}
export const Weeks: StoryObj = { render: () => <Live /> };
export const ReadOnly: StoryObj = {
  render: () => (
    <div style={{ height: 300, display: 'flex' }}>
      <PlannerGrid readOnly label="My schedule" columns={['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((label) => ({ key: label, label }))}
        rows={[{ id: 'w1', label: '02 Nov', sublabel: '28 h' }]}
        allocations={[{ id: 'x', rowId: 'w1', column: 0, hours: 4, label: 'PRJ-01 · Concept design', kind: 'confirmed' }]}
        markers={[{ rowId: 'w1', column: 3, label: 'Lakeview site' }]}
        off={[{ rowId: 'w1', column: 4, label: 'Holiday' }]}
      />
    </div>
  ),
};
export const Virtualized: StoryObj = {
  render: () => (
    <div style={{ height: 420, display: 'flex' }}>
      <PlannerGrid label="500 people" columns={columns} allocations={[]} rows={Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, label: `Person ${i + 1}` }))} />
    </div>
  ),
};
export const Loading: StoryObj = { render: () => <Skeleton kind="planner" /> };

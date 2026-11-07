import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { KanbanBoard } from '.';

const meta: Meta = { title: 'Data display/KanbanBoard' };
export default meta;
type Card = { id: string; title: string; stage: string };
function Demo() {
  const [cards, set] = useState<Card[]>([{ id: '1', title: 'Riverside School Block', stage: 'Proposal' }, { id: '2', title: 'Palm Grove Villas', stage: 'Qualified' }]);
  return (
    <KanbanBoard
      label="Pipeline" itemKey={(c) => c.id} itemLabel={(c) => c.title} renderCard={(c) => <span>{c.title}</span>}
      onMove={(c, to) => set((l) => l.map((x) => (x.id === c.id ? { ...x, stage: to } : x)))}
      columns={['Qualified', 'Proposal', 'Won'].map((key) => ({ key, label: key, items: cards.filter((c) => c.stage === key), emptyText: 'Nothing in this stage.' }))}
    />
  );
}
export const Default: StoryObj = { render: () => <Demo /> };

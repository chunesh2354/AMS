import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Combobox } from '.';

const meta: Meta<typeof Combobox> = { title: 'Input/Combobox', component: Combobox };
export default meta;
const CLIENTS = ['Lakeview Trust', 'Orchard Developers', 'Heritage Hospitality'].map((c) => ({ value: c, label: c }));
function Live() {
  const [v, set] = useState<string | null>('Lakeview Trust');
  const [opts, setOpts] = useState(CLIENTS);
  return <Combobox label="Client" options={opts} value={v} onChange={set} helper="Type to search or create" onCreate={(t) => { setOpts([...opts, { value: t, label: t }]); set(t); }} />;
}
export const States: StoryObj = {
  render: () => (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 560 }}>
      <Live />
      <Combobox label="Client" options={CLIENTS} value={null} error="A client is required" placeholder="Search clients" />
      <Combobox label="Client" options={CLIENTS} value="Lakeview Trust" disabled />
      <Combobox label="Client" options={CLIENTS} value="Lakeview Trust" readOnly />
    </div>
  ),
};
export const Open: StoryObj = { render: () => <div style={{ height: 220, maxWidth: 280 }}><Combobox defaultOpen label="Client" options={CLIENTS} value="Lakeview Trust" /></div> };

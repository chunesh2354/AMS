import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Form, FormFooter, FormSection } from '.';
import { TextField } from '../TextField';
import { MoneyField } from '../MoneyField';
import { PercentField } from '../PercentField';
import { Button } from '../Button';

const meta: Meta = { title: 'Input/Form' };
export default meta;
function Demo() {
  const [vendor, setVendor] = useState('');
  const [tried, setTried] = useState(false);
  const missing = tried && !vendor;
  return (
    <div style={{ width: 640, background: 'var(--surface)', padding: 24, border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)' }}>
      <Form onSubmit={(e) => { e.preventDefault(); setTried(true); }}>
        <FormSection title="Consultant bill" columns={2}>
          <TextField label="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} error={missing ? 'Vendor is required' : undefined} />
          <MoneyField label="Amount" value={250000} />
          <PercentField label="Markup" defaultValue="10" />
        </FormSection>
        <FormSection title="Allocation">
          <TextField label="Project and phase" defaultValue="PRJ-02 · Schematic design" readOnly />
        </FormSection>
        <FormFooter summary={missing ? '1 field needs attention' : undefined}>
          <Button variant="ghost">Cancel</Button>
          <Button type="submit" variant="primary">Save</Button>
        </FormFooter>
      </Form>
    </div>
  );
}
export const Validation: StoryObj = { render: () => <Demo /> };

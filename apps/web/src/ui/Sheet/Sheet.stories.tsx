import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Sheet } from '.';
import { Button } from '../Button';
import { Form, FormSection } from '../Form';
import { TextField } from '../TextField';
import { MoneyField } from '../MoneyField';

const meta: Meta<typeof Sheet> = { title: 'Shell/Sheet', component: Sheet, parameters: { layout: 'fullscreen' } };
export default meta;
function Demo({ size, dirtyOnOpen }: { size: 480 | 640; dirtyOnOpen?: boolean }) {
  const [open, setOpen] = useState(true);
  const [vendor, setVendor] = useState(dirtyOnOpen ? 'Structural consultant' : '');
  return (
    <div style={{ padding: 32, minHeight: 640 }}>
      <Button onClick={() => setOpen(true)}>Open sheet</Button>
      <Sheet
        open={open} onClose={() => setOpen(false)} size={size} dirty={vendor !== ''}
        title="New consultant bill" description="Bills need approval before they are payable."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary">Save</Button></>}
      >
        <Form>
          <FormSection columns={size === 640 ? 2 : 1}>
            <TextField label="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            <MoneyField label="Amount" value={250000} />
          </FormSection>
        </Form>
      </Sheet>
    </div>
  );
}
export const Form480: StoryObj = { render: () => <Demo size={480} /> };
export const Detail640: StoryObj = { render: () => <Demo size={640} /> };
export const UnsavedChanges: StoryObj = { render: () => <Demo size={480} dirtyOnOpen /> };

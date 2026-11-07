import { useState } from 'react';
import { personName, type Person } from '../../api';
import { OFFICES } from '../../mock/studio-meridian';
import { Button } from '../../ui/Button';
import { Form, FormSection } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { PersonPicker } from '../../ui/PersonPicker';
import { Select } from '../../ui/Select';
import { Sheet } from '../../ui/Sheet';
import { TextArea } from '../../ui/TextArea';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';

export function EditPersonSheet({ person, open, onClose, people }: { person: Person | null; open: boolean; onClose: () => void; people: Person[] }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [manager, setManager] = useState<string | null>(null);
  const [office, setOffice] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) { setWasOpen(true); setTitle(person?.title ?? ''); setManager(person?.managerId ?? null); setOffice(person?.office ?? null); setTried(false); }
  if (!open && wasOpen) setWasOpen(false);
  const save = () => {
    if (!title.trim()) { setTried(true); return; }
    toast({ variant: 'success', message: `${person?.name} checked. Nothing is saved in this demo.` });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Edit person" description={person?.name} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <Form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormSection>
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={tried && !title.trim() ? 'Enter a title' : undefined} />
          <PersonPicker label="Manager" people={people.filter((p) => p.id !== person?.id && !p.roles.every((r) => r === 'staff')).map((p) => ({ id: p.id, name: p.name, title: p.title }))} value={manager} onChange={setManager} />
          <Select label="Office" options={OFFICES.map((o) => ({ value: o, label: o }))} value={office} onChange={setOffice} />
        </FormSection>
      </Form>
    </Sheet>
  );
}

export function DeactivateSheet({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const close = () => { setReason(''); setTried(false); onClose(); };
  const go = () => {
    if (!reason.trim()) { setTried(true); return; }
    toast({ variant: 'warn', message: `${person?.name} would be deactivated. Nothing is saved in this demo.` });
    close();
  };
  return (
    <Sheet open={!!person} onClose={close} title="Deactivate person" description={person?.name} dirty={reason !== ''} footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="danger" onClick={go}>Deactivate</Button></>}>
      <div className="stack-4">
        <InlineAlert variant="warn" title="Their login stops working">Open allocations stay on the plan for {person ? personName(person.managerId) : 'their manager'} to reassign.</InlineAlert>
        <Form onSubmit={(e) => { e.preventDefault(); go(); }}>
          <FormSection>
            <TextArea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={tried && !reason.trim() ? 'Say why' : undefined} />
          </FormSection>
        </Form>
      </div>
    </Sheet>
  );
}

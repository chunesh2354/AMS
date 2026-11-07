import { useState } from 'react';
import type { Person } from '../../api';
import { PERMISSION_SETS, OFFICES } from '../../mock/studio-meridian';
import { Button } from '../../ui/Button';
import { DateField } from '../../ui/DateField';
import { Form, FormSection } from '../../ui/Form';
import { NumberField } from '../../ui/NumberField';
import { PersonPicker } from '../../ui/PersonPicker';
import { Select } from '../../ui/Select';
import { Sheet } from '../../ui/Sheet';
import { Stepper } from '../../ui/Stepper';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { formatDate } from '../../ui/format';

const STEPS = ['Details', 'Access', 'Capacity', 'Review'];
const BLANK = { name: '', email: '', title: '', permission: 'Staff' as string | null, manager: null as string | null, office: OFFICES[0] as string | null, start: '2026-11-16' as string | null, hours: '40' };

/** Four-step wizard. Nothing is persisted in this build; finishing only confirms with a toast. */
export function AddPersonSheet({ open, onClose, people }: { open: boolean; onClose: () => void; people: Person[] }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(BLANK);
  const [tried, setTried] = useState(false);
  const toast = useToast();
  const set = <K extends keyof typeof BLANK>(k: K, v: (typeof BLANK)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const errors: Record<string, string | undefined> = {
    name: step === 0 && !form.name.trim() ? 'Full name is required' : undefined,
    email: step === 0 && !/^\S+@\S+\.\S+$/.test(form.email) ? 'Enter a valid work email' : undefined,
    manager: step === 1 && !form.manager ? 'Choose a manager' : undefined,
    hours: step === 2 && !(Number(form.hours) > 0 && Number(form.hours) <= 60) ? 'Hours must be between 1 and 60' : undefined,
  };
  const show = (k: string) => (tried ? errors[k] : undefined);
  const invalid = Object.values(errors).some(Boolean);
  const dirty = form.name !== '' || form.email !== '' || form.title !== '';

  const reset = () => { setStep(0); setForm(BLANK); setTried(false); };
  const close = () => { reset(); onClose(); };
  const next = () => {
    if (invalid) { setTried(true); return; }
    setTried(false);
    if (step < STEPS.length - 1) { setStep(step + 1); return; }
    toast({ variant: 'success', message: `Invitation ready for ${form.name}. Nothing is saved in this demo.` });
    close();
  };

  return (
    <Sheet
      open={open} onClose={close} title="Add person" dirty={dirty}
      description="They get an invitation once this is finished."
      footer={(
        <>
          {tried && invalid && <span className="form__summary" role="status">Fix the highlighted field to continue</span>}
          {step > 0 && <Button variant="ghost" onClick={() => { setTried(false); setStep(step - 1); }}>Back</Button>}
          <Button variant="primary" onClick={next}>{step === STEPS.length - 1 ? 'Send invitation' : 'Save and continue'}</Button>
        </>
      )}
    >
      <Stepper steps={STEPS} current={step} />
      <Form onSubmit={(e) => { e.preventDefault(); next(); }}>
        {step === 0 && (
          <FormSection>
            <TextField label="Full name" value={form.name} onChange={(e) => set('name', e.target.value)} error={show('name')} autoComplete="off" />
            <TextField label="Work email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={show('email')} helper="The invitation goes here." autoComplete="off" />
            <TextField label="Title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Architect" />
          </FormSection>
        )}
        {step === 1 && (
          <FormSection>
            <Select label="Permission set" options={PERMISSION_SETS.map((p) => ({ value: p, label: p }))} value={form.permission} onChange={(v) => set('permission', v)} />
            <PersonPicker label="Manager" people={people.filter((p) => !p.roles.every((r) => r === 'staff')).map((p) => ({ id: p.id, name: p.name, title: p.title }))} value={form.manager} onChange={(v) => set('manager', v)} error={show('manager')} />
            <Select label="Office" options={OFFICES.map((o) => ({ value: o, label: o }))} value={form.office} onChange={(v) => set('office', v)} />
          </FormSection>
        )}
        {step === 2 && (
          <FormSection>
            <DateField label="Start date" value={form.start} onChange={(v) => set('start', v)} today="2026-11-06" min="2026-11-06" />
            <NumberField label="Hours per week" value={form.hours} onChange={(e) => set('hours', e.target.value)} error={show('hours')} />
          </FormSection>
        )}
        {step === 3 && (
          <FormSection title="Review">
            <dl className="def-list">
              <dt>Name</dt><dd>{form.name}</dd>
              <dt>Email</dt><dd>{form.email}</dd>
              <dt>Title</dt><dd>{form.title || 'Not set'}</dd>
              <dt>Permission</dt><dd>{form.permission}</dd>
              <dt>Manager</dt><dd>{people.find((p) => p.id === form.manager)?.name}</dd>
              <dt>Office</dt><dd>{form.office}</dd>
              <dt>Start</dt><dd className="t-numeric">{form.start ? formatDate(form.start) : 'Not set'}</dd>
              <dt>Capacity</dt><dd className="t-numeric">{form.hours} h</dd>
            </dl>
          </FormSection>
        )}
      </Form>
    </Sheet>
  );
}

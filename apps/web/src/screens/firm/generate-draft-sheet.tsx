import { useState } from 'react';
import { type Person, type ReadyItem } from '../../api';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Form, FormSection } from '../../ui/Form';
import { PersonPicker } from '../../ui/PersonPicker';
import { Sheet } from '../../ui/Sheet';
import { Stepper } from '../../ui/Stepper';
import { useToast } from '../../ui/Toast';
import { formatINR } from '../../ui/format';

const STEPS = ['Lines', 'Review', 'Approver'];

/** Three-step wizard. Excess never enters a draft. Nothing is persisted. */
export function GenerateDraftSheet({ open, onClose, items, excess, people }: { open: boolean; onClose: () => void; items: ReadyItem[]; excess?: number; people: Person[] }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [approver, setApprover] = useState<string | null>('P01');
  const [tried, setTried] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) { setWasOpen(true); setStep(0); setPicked(items.map((i) => i.id)); setApprover('P01'); setTried(false); }
  if (!open && wasOpen) setWasOpen(false);
  const chosen = items.filter((i) => picked.includes(i.id));
  const total = chosen.reduce((s, i) => s + i.amount, 0);
  const invalid = (step === 0 && !chosen.length) || (step === 2 && !approver);
  const next = () => {
    if (invalid) { setTried(true); return; }
    setTried(false);
    if (step < STEPS.length - 1) { setStep(step + 1); return; }
    toast({ variant: 'success', message: `Draft of ${formatINR(total)} sent to ${people.find((p) => p.id === approver)?.name}. Nothing is saved in this demo.` });
    onClose();
  };
  return (
    <Sheet
      open={open} onClose={onClose} title="Generate billing draft"
      footer={(
        <>
          {tried && invalid && <span className="form__summary" role="status">{step === 0 ? 'Choose at least one line' : 'Choose an approver'}</span>}
          {step > 0 ? <Button variant="ghost" onClick={() => { setTried(false); setStep(step - 1); }}>Back</Button> : <Button variant="ghost" onClick={onClose}>Cancel</Button>}
          <Button variant="primary" onClick={next}>{step === STEPS.length - 1 ? 'Send for approval' : 'Save and continue'}</Button>
        </>
      )}
    >
      <Stepper steps={STEPS} current={step} />
      <Form onSubmit={(e) => { e.preventDefault(); next(); }}>
        {step === 0 && (
          <FormSection title="Ready to bill">
            <ul className="check-list">
              {items.map((i) => (
                <li key={i.id} className="toolbar toolbar--between">
                  <Checkbox label={`${i.project} ${i.component}`} description={i.basis} checked={picked.includes(i.id)} onChange={(e) => setPicked((l) => (e.target.checked ? [...l, i.id] : l.filter((x) => x !== i.id)))} />
                  <span className="t-numeric">{formatINR(i.amount)}</span>
                </li>
              ))}
            </ul>
          </FormSection>
        )}
        {step === 1 && (
          <FormSection title="Review">
            <dl className="calc">
              {chosen.map((i) => <div key={i.id} style={{ display: 'contents' }}><dt>{i.component}, {i.basis}</dt><dd>{formatINR(i.amount)}</dd></div>)}
              <dt className="calc__strong">Draft total</dt><dd className="calc__strong">{formatINR(total)}</dd>
            </dl>
            {excess ? <p className="t-body-sm ink-2">Excess of <span className="t-numeric">{formatINR(excess)}</span> stays out of this draft.</p> : null}
          </FormSection>
        )}
        {step === 2 && (
          <FormSection>
            <PersonPicker label="Approver" people={people.filter((p) => p.roles.includes('principal')).map((p) => ({ id: p.id, name: p.name, title: p.title }))} value={approver} onChange={setApprover} />
          </FormSection>
        )}
      </Form>
    </Sheet>
  );
}

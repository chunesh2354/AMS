import { useState } from 'react';
import type { Person, Proposal } from '../../api';
import { SETTINGS_LISTS } from '../../mock/studio-meridian';
import { AvatarGroup } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Form, FormSection } from '../../ui/Form';
import { MultiSelect } from '../../ui/MultiSelect';
import { PersonPicker } from '../../ui/PersonPicker';
import { Select } from '../../ui/Select';
import { Sheet } from '../../ui/Sheet';
import { Stepper } from '../../ui/Stepper';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { formatGrouped, formatINR } from '../../ui/format';

const STEPS = ['Project', 'Phases', 'Team', 'Review'];

/** Four-step wizard. From a proposal the phases and fee come across read-only. Nothing is persisted. */
export function CreateProjectSheet({ open, onClose, people, proposal }: { open: boolean; onClose: () => void; people: Person[]; proposal?: Proposal | null }) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [code, setCode] = useState('PRJ-04');
  const [name, setName] = useState(proposal?.name ?? '');
  const [pm, setPm] = useState<string | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  const [team, setTeam] = useState<string[]>([]);
  const [tried, setTried] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) { setWasOpen(true); setStep(0); setCode('PRJ-04'); setName(proposal?.name ?? ''); setPm(null); setTemplate(null); setTeam([]); setTried(false); }
  if (!open && wasOpen) setWasOpen(false);

  const hours = proposal?.phases.reduce((s, p) => s + p.hours, 0) ?? 0;
  const fee = proposal?.fees.reduce((s, f) => s + f.amount, 0) ?? 0;
  const errors: Record<string, string | undefined> = step === 0
    ? { code: !code.trim() ? 'Enter a project code' : undefined, name: !name.trim() ? 'Name the project' : undefined, pm: !pm ? 'Choose a project manager' : undefined }
    : step === 1 && !proposal ? { template: !template ? 'Choose a template' : undefined } : {};
  const invalid = Object.values(errors).some(Boolean);
  const err = (k: string) => (tried ? errors[k] : undefined);
  const next = () => {
    if (invalid) { setTried(true); return; }
    setTried(false);
    if (step < STEPS.length - 1) { setStep(step + 1); return; }
    toast({ variant: 'success', message: `${code} ${name} is ready. Nothing is saved in this demo.` });
    onClose();
  };
  const pmName = people.find((p) => p.id === pm)?.name ?? 'Not set';
  const managers = people.filter((p) => !p.roles.every((r) => r === 'staff')).map((p) => ({ id: p.id, name: p.name, title: p.title }));
  return (
    <Sheet
      open={open} onClose={onClose} title="Create project" description={proposal ? `From ${proposal.name} ${proposal.version}` : undefined} dirty={step > 0 || !!pm}
      footer={(
        <>
          {tried && invalid && <span className="form__summary" role="status">Fix the highlighted field to continue</span>}
          {step > 0 ? <Button variant="ghost" onClick={() => { setTried(false); setStep(step - 1); }}>Back</Button> : <Button variant="ghost" onClick={onClose}>Cancel</Button>}
          <Button variant="primary" onClick={next}>{step === STEPS.length - 1 ? 'Create project' : 'Save and continue'}</Button>
        </>
      )}
    >
      <Stepper steps={STEPS} current={step} />
      <Form onSubmit={(e) => { e.preventDefault(); next(); }}>
        {step === 0 && (
          <FormSection>
            <TextField label="Project code" value={code} onChange={(e) => setCode(e.target.value)} error={err('code')} />
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={err('name')} />
            <PersonPicker label="Project manager" people={managers} value={pm} onChange={setPm} error={err('pm')} />
          </FormSection>
        )}
        {step === 1 && (proposal
          ? (
            <FormSection title="From the accepted proposal">
              <p className="t-body-sm"><span className="t-numeric">{proposal.phases.length}</span> phases and <span className="t-numeric">{formatGrouped(hours)} h</span> come from the accepted proposal.</p>
              <ul className="link-list">{proposal.phases.map((p) => <li key={p.name}><span>{p.name}</span><span className="t-numeric">{formatGrouped(p.hours)} h</span></li>)}</ul>
            </FormSection>
          )
          : (
            <FormSection>
              <Select label="Phase template" options={SETTINGS_LISTS.templates.map((t) => ({ value: t.name, label: t.name }))} value={template} onChange={setTemplate} error={err('template')} />
            </FormSection>
          ))}
        {step === 2 && (
          <FormSection>
            <MultiSelect label="Team" helper="Allocations are planned later, in Staffing." options={people.map((p) => ({ value: p.id, label: p.name }))} value={team} onChange={setTeam} />
          </FormSection>
        )}
        {step === 3 && (
          <FormSection title="Review">
            <dl className="def-list">
              <dt>Code</dt><dd className="t-numeric">{code}</dd>
              <dt>Name</dt><dd>{name}</dd>
              <dt>PM</dt><dd>{pmName}</dd>
              <dt>Phases</dt><dd>{proposal ? `${proposal.phases.length} phases, ${formatGrouped(hours)} h` : template}</dd>
              {proposal && <><dt>Fee</dt><dd className="t-numeric">{formatINR(fee)}</dd></>}
              <dt>Team</dt><dd>{team.length ? <AvatarGroup size={20} names={team.map((id) => people.find((p) => p.id === id)?.name ?? id)} /> : 'Nobody yet'}</dd>
            </dl>
          </FormSection>
        )}
      </Form>
    </Sheet>
  );
}

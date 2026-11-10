import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiFailure, failureMessage, isLive } from '../../api/live';
import { createClient, createWizardProject, listClients, listProjectCandidates, splitFee, whoAmI, type CandidatePerson, type Client, type FeeBasis, type WizardProject } from '../../api/live/setup';
import type { Person, Proposal } from '../../api';
import { SETTINGS_LISTS } from '../../mock/studio-meridian';
import { AvatarGroup } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Form, FormSection } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { MoneyField } from '../../ui/MoneyField';
import { MultiSelect } from '../../ui/MultiSelect';
import { PercentField } from '../../ui/PercentField';
import { PersonPicker } from '../../ui/PersonPicker';
import { Select } from '../../ui/Select';
import { Sheet } from '../../ui/Sheet';
import { Stepper } from '../../ui/Stepper';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { formatGrouped, formatINR } from '../../ui/format';

const STEPS = ['Project', 'Phases', 'Team', 'Review'];

type SheetProps = { open: boolean; onClose: () => void; people: Person[]; proposal?: Proposal | null };

/** Live mode saves through POST /projects and opens the new project. Mock mode is the four-step demo wizard. */
export function CreateProjectSheet(props: SheetProps) {
  return isLive ? <LiveCreateProjectSheet open={props.open} onClose={props.onClose} proposal={props.proposal} /> : <MockCreateProjectSheet {...props} />;
}

/** Four-step wizard. From a proposal the phases and fee come across read-only. Nothing is persisted. */
function MockCreateProjectSheet({ open, onClose, people, proposal }: SheetProps) {
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
          <FormSection title="Team">
            <MultiSelect label="Team" helper="Allocations are planned later, in Staffing." options={people.map((p) => ({ value: p.id, label: p.name }))} value={team} onChange={setTeam} />
          </FormSection>
        )}
        {step === 2 && (
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

// ---------- Live mode ----------

// The team is picked on the last step, beside the summary, so a studio can create a project in three steps.
const LIVE_STEPS = ['Project', 'Phases and fee', 'Team and review'];
const NEW_CLIENT = '__new_client__';

/** Phase templates a new studio can start from. Codes match the demo projects. */
const LIVE_TEMPLATES: { name: string; method: FeeBasis; phases: [string, string][] }[] = [
  { name: 'Residential, 6 phases', method: 'fixed_percent', phases: [['CD', 'Concept design'], ['SD', 'Schematic design'], ['DD', 'Design development'], ['WD', 'Working drawings'], ['TN', 'Tender'], ['SS', 'Site supervision']] },
  { name: 'Commercial, 5 phases', method: 'percent_construction', phases: [['CD', 'Concept design'], ['SD', 'Schematic design'], ['DD', 'Design development'], ['WD', 'Working drawings'], ['SS', 'Site supervision']] },
  { name: 'Refit, 4 phases', method: 'fixed_percent', phases: [['CD', 'Concept design'], ['DD', 'Design development'], ['WD', 'Working drawings'], ['SS', 'Site supervision']] },
];

/** How the project is billed. Each one becomes billable from the Billing tab once its source exists. */
const FEE_BASES: { value: FeeBasis; label: string; helper: string }[] = [
  { value: 'fixed_percent', label: 'Fixed fee', helper: 'Split the fee across phases. A principal authorizes progress per phase on the Billing tab, and that is billed.' },
  { value: 'percent_construction', label: 'Percent of construction cost', helper: 'Billed by milestones a principal authorizes on the Billing tab.' },
  { value: 'hourly', label: 'Hourly', helper: 'Approved time is billed at each person’s bill rate.' },
  { value: 'hourly_nte', label: 'Hourly up to a cap', helper: 'Approved time at bill rates, up to the cap. Hours over it need a change.' },
];
const basisLabel = (b: FeeBasis) => FEE_BASES.find((x) => x.value === b)?.label ?? b;

/** "Concept design" to "CD", made unique within the project. */
function phaseCodes(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n, i) => {
    let code = n.split(/\s+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase()).join('').slice(0, 4) || `PH${i + 1}`;
    if (seen.has(code)) code = `${code}${i + 1}`;
    seen.add(code);
    return code;
  });
}

type LiveDraft = {
  code: string; name: string; client: string | null; newClient: string; pm: string | null; template: string | null;
  basis: FeeBasis; fee: number | null; feePercent: string; cap: number | null;
  /** Phase fees by phase code, once the user edits one. Until then the fee is split evenly. */
  phaseFees: Record<string, number | null> | null;
  principal: string | null; team: string[];
};

const paise = (v: number) => Math.round(v * 100);

/** Live wizard: project, client (pick or add), PM, phases and fee basis, team and principal, then POST /projects and open it. */
function LiveCreateProjectSheet({ open, onClose, proposal }: { open: boolean; onClose: () => void; proposal?: Proposal | null }) {
  const toast = useToast();
  const navigate = useNavigate();
  const blank = (): LiveDraft => ({
    code: '', name: proposal?.name ?? '', client: null, newClient: proposal?.client ?? '', pm: null, template: null,
    basis: 'fixed_percent', fee: proposal ? proposal.fees.reduce((s, f) => s + f.amount, 0) : null, feePercent: '', cap: null, phaseFees: null,
    principal: null, team: [],
  });
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<LiveDraft>(blank);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ code?: string; newClient?: string }>({});
  const [clients, setClients] = useState<Client[] | null>(null);
  const [people, setPeople] = useState<CandidatePerson[] | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) { setWasOpen(true); setStep(0); setForm(blank()); setTried(false); setServerError(null); setFieldError({}); }
  if (!open && wasOpen) setWasOpen(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoadError(null);
    Promise.all([listClients(), listProjectCandidates()]).then(
      ([c, p]) => { if (live) { setClients(c); setPeople(p); } },
      (e) => { if (live) setLoadError(failureMessage(e)); },
    );
    // The creating principal is the default principal. Anyone else leaves it to the server: the firm's first principal.
    whoAmI().then(
      (m) => { if (live && m.principal) { setMe(m.id); setForm((f) => (f.principal || f.pm === m.id ? f : { ...f, principal: m.id })); } },

      () => {},
    );
    return () => { live = false; };
  }, [open]);

  const set = <K extends keyof LiveDraft>(k: K, v: LiveDraft[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === 'code' || k === 'newClient') setFieldError((e) => ({ ...e, [k]: undefined }));
  };
  // The PM's own time goes to the principal, so the principal is never the PM.
  const setPm = (id: string | null) => setForm((f) => ({ ...f, pm: id, principal: f.principal && f.principal === id ? null : f.principal }));
  const addingClient = form.client === NEW_CLIENT;
  const template = LIVE_TEMPLATES.find((t) => t.name === form.template) ?? null;
  const phaseList: { code: string; name: string; budget_hours?: number }[] = proposal
    ? phaseCodes(proposal.phases.map((p) => p.name)).map((code, i) => ({ code, name: proposal.phases[i]?.name ?? code, budget_hours: proposal.phases[i]?.hours }))
    : (template?.phases ?? []).map(([code, name]) => ({ code, name }));
  const fixed = form.basis === 'fixed_percent';
  const even = form.fee != null ? splitFee(form.fee, phaseList.length) : [];
  const phaseFee = (code: string, i: number): number | null => (form.phaseFees ? form.phaseFees[code] ?? null : even[i] ?? null);
  const feeSum = phaseList.reduce((s, p, i) => s + paise(phaseFee(p.code, i) ?? 0), 0) / 100;
  const feesMissing = phaseList.some((p, i) => phaseFee(p.code, i) == null);
  const pct = form.feePercent.trim() === '' ? null : Number(form.feePercent);

  const errors: Record<string, string | undefined> = step === 0
    ? {
      code: !form.code.trim() ? 'Enter a project code' : fieldError.code,
      name: !form.name.trim() ? 'Name the project' : undefined,
      client: !form.client ? 'Choose a client or add a new one' : undefined,
      newClient: addingClient && !form.newClient.trim() ? 'Enter the client name' : addingClient ? fieldError.newClient : undefined,
      pm: !form.pm ? 'Choose a project manager' : undefined,
    }
    : step === 1
      ? {
        template: !proposal && !template ? 'Choose a template' : undefined,
        fee: fixed && !(form.fee != null && form.fee > 0) ? 'Enter the contracted fee' : undefined,
        phaseFees: fixed && form.fee != null && phaseList.length
          ? feesMissing ? 'Enter a fee for every phase'
            : paise(feeSum) !== paise(form.fee) ? `Phase fees add up to ${formatINR(feeSum)}. They must add up to the fee of ${formatINR(form.fee)}.` : undefined
          : undefined,
        cap: form.basis === 'hourly_nte' && !(form.cap != null && form.cap > 0) ? 'Enter the cap' : undefined,
        feePercent: form.basis === 'percent_construction' && pct != null && !(pct > 0 && pct <= 100) ? 'Enter a percent above 0 and at most 100' : undefined,
      }
      : {};
  const invalid = Object.values(errors).some(Boolean);
  const err = (k: string) => (tried || (k === 'code' && fieldError.code) || (k === 'newClient' && fieldError.newClient) ? errors[k] : undefined);

  const clientLabel = addingClient ? `${form.newClient.trim()} (new)` : clients?.find((c) => c.id === form.client)?.name ?? '';
  const nameOf = (id: string | null) => people?.find((p) => p.id === id)?.name ?? 'Not set';

  const editPhaseFee = (code: string, v: number | null) => setForm((f) => {
    const base = f.phaseFees ?? Object.fromEntries(phaseList.map((p, i) => [p.code, even[i] ?? null]));
    return { ...f, phaseFees: { ...base, [code]: v } };
  });
  const pickTemplate = (v: string) => {
    const t = LIVE_TEMPLATES.find((x) => x.name === v);
    setForm((f) => ({ ...f, template: v, basis: t?.method ?? f.basis, phaseFees: null }));
  };

  const body = (clientId: string): WizardProject => ({
    code: form.code.trim(), name: form.name.trim(), client_id: clientId, pm_id: form.pm ?? '', billing_method: form.basis,
    ...(form.principal ? { principal_id: form.principal } : {}),
    ...(fixed && form.fee != null ? { contracted_amount: form.fee } : {}),
    ...(form.basis === 'percent_construction' && pct != null ? { fee_percent: pct } : {}),
    ...(form.basis === 'hourly_nte' && form.cap != null ? { cap_amount: form.cap } : {}),
    phases: phaseList.map((p, i) => ({
      code: p.code, name: p.name, ...(p.budget_hours != null ? { budget_hours: p.budget_hours } : {}),
      ...(fixed && form.fee != null ? { fee: phaseFee(p.code, i) ?? 0 } : {}),
    })),
    members: form.team.filter((id) => id !== form.pm).map((id) => ({ person_id: id, role: 'contributor' as const })),
  });

  const submit = async () => {
    setServerError(null);
    setBusy(true);
    let clientId = form.client;
    try {
      if (addingClient) {
        const c = await createClient(form.newClient.trim());
        clientId = c.id;
        // Keep the new client selected, so a retry after a project error does not add it twice.
        setClients((cs) => [...(cs ?? []), { id: c.id, name: c.name }]);
        setForm((f) => ({ ...f, client: c.id }));
      }
      const res = await createWizardProject(body(clientId ?? ''));
      toast({ variant: 'success', message: `${res.code} ${form.name.trim()} created.` });
      onClose();
      navigate(`/firm/projects/${encodeURIComponent(res.code)}`);
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'DUPLICATE_CODE') { setFieldError({ code: e.message }); setStep(0); }
      else if (e instanceof ApiFailure && e.code === 'DUPLICATE_NAME') { setFieldError({ newClient: e.message }); setStep(0); }
      else setServerError(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    if (invalid) { setTried(true); return; }
    setTried(false);
    if (step < LIVE_STEPS.length - 1) { setStep(step + 1); return; }
    void submit();
  };

  const active = (people ?? []).filter((p) => p.employment_state === 'Active' && p.login_state !== 'Revoked');
  const asOption = (p: CandidatePerson) => ({ id: p.id, name: p.name, title: p.job_title ?? undefined });
  // Only people the server accepts: a PM holds the pm or principal set, a principal the principal set (and is not the PM).
  const managers = active.filter((p) => p.can_be_pm).map(asOption);
  const principals = active.filter((p) => p.can_be_principal && p.id !== form.pm).map(asOption);
  const teamOptions = active.filter((p) => p.id !== form.pm).map((p) => ({ value: p.id, label: p.name }));
  const clientOptions = [...(clients ?? []).map((c) => ({ value: c.id, label: c.name })), { value: NEW_CLIENT, label: 'Add a new client' }];
  const dirty = step > 0 || !!form.code || !!form.pm || !!form.client;
  const basis = FEE_BASES.find((b) => b.value === form.basis);
  const principalLabel = form.principal ? nameOf(form.principal) : 'Another principal of the firm, if there is one';
  const feeText = fixed ? (form.fee != null ? formatINR(form.fee) : 'Not set')
    : form.basis === 'percent_construction' ? (pct != null ? `${pct}% of construction cost` : 'Not set')
      : form.basis === 'hourly_nte' ? (form.cap != null ? `Up to ${formatINR(form.cap)}` : 'Not set') : 'Approved time at bill rates';
  const phaseError = err('phaseFees');
  return (
    <Sheet
      open={open} onClose={onClose} title="Create project" description={proposal ? `From ${proposal.name} ${proposal.version}` : undefined} dirty={dirty && !busy}
      footer={(
        <>
          {tried && invalid && <span className="form__summary" role="status">Fix the highlighted field to continue</span>}
          {step > 0 ? <Button variant="ghost" disabled={busy} onClick={() => { setTried(false); setStep(step - 1); }}>Back</Button> : <Button variant="ghost" onClick={onClose}>Cancel</Button>}
          <Button variant="primary" loading={busy} onClick={next}>{step === LIVE_STEPS.length - 1 ? 'Create project' : 'Save and continue'}</Button>
        </>
      )}
    >
      <Stepper steps={LIVE_STEPS} current={step} />
      {loadError && <InlineAlert variant="danger" title={loadError} />}
      {serverError && <InlineAlert variant="danger" title={serverError} />}
      <Form onSubmit={(e) => { e.preventDefault(); next(); }} aria-label="Create project">
        {step === 0 && (
          <FormSection>
            <TextField label="Project code" value={form.code} onChange={(e) => set('code', e.target.value)} error={err('code')} helper="For example PRJ-04" autoComplete="off" />
            <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} error={err('name')} />
            <Select label="Client" options={clientOptions} value={form.client} onChange={(v) => set('client', v)} error={err('client')} placeholder={clients ? 'Select' : 'Loading clients'} />
            {addingClient && <TextField label="New client name" value={form.newClient} onChange={(e) => set('newClient', e.target.value)} error={err('newClient')} helper="Saved when the project is created." />}
            <PersonPicker label="Project manager" people={managers} value={form.pm} onChange={setPm} error={err('pm')} helper="A project manager or a principal." />
          </FormSection>
        )}
        {step === 1 && (
          <>
            <FormSection>
              {proposal
                ? <p className="t-body-sm"><span className="t-numeric">{proposal.phases.length}</span> phases come from the accepted proposal.</p>
                : <Select label="Phase template" options={LIVE_TEMPLATES.map((t) => ({ value: t.name, label: t.name }))} value={form.template} onChange={pickTemplate} error={err('template')} />}
              <Select label="Fee basis" options={FEE_BASES.map((b) => ({ value: b.value, label: b.label }))} value={form.basis} onChange={(v) => setForm((f) => ({ ...f, basis: v as FeeBasis }))} helper={basis?.helper} />
              {fixed && <MoneyField label="Contracted fee" value={form.fee} onChange={(v) => setForm((f) => ({ ...f, fee: v, phaseFees: null }))} error={err('fee')} helper="Split across the phases below. A principal authorizes progress against each phase’s fee." />}
              {form.basis === 'percent_construction' && <PercentField label="Fee percent" value={form.feePercent} onChange={(e) => set('feePercent', e.target.value)} error={err('feePercent')} helper="Optional. Milestones are billed as a principal authorizes them." />}
              {form.basis === 'hourly_nte' && <MoneyField label="Cap" value={form.cap} onChange={(v) => set('cap', v)} error={err('cap')} helper="Hourly work is billed up to this amount." />}
            </FormSection>
            {phaseList.length > 0 && (fixed && form.fee != null
              ? (
                <FormSection title="Fee by phase">
                  {phaseList.map((p, i) => (
                    <MoneyField key={p.code} label={`${p.name} fee`} value={phaseFee(p.code, i)} onChange={(v) => editPhaseFee(p.code, v)} dense />
                  ))}
                  {phaseError
                    ? <p className="field__error" role="alert">{phaseError}</p>
                    : <p className="t-caption ink-2">Phase fees add up to <span className="t-numeric">{formatINR(feeSum)}</span> of <span className="t-numeric">{formatINR(form.fee)}</span>.</p>}
                  {form.phaseFees && <Button variant="ghost" size="dense" onClick={() => setForm((f) => ({ ...f, phaseFees: null }))}>Split evenly</Button>}
                </FormSection>
              )
              : <ul className="link-list">{phaseList.map((p) => <li key={p.code}><span>{p.name}</span><span className="t-numeric">{p.code}</span></li>)}</ul>)}
          </>
        )}
        {step === 2 && (
          <FormSection title="Team">
            <MultiSelect label="Team" helper="Team members can see the project and log time on it. The PM is on the team already." options={teamOptions} value={form.team} onChange={(v) => set('team', v)} />
            <PersonPicker label="Principal" people={principals} value={form.principal} onChange={(id) => set('principal', id)} helper={me && me !== form.pm ? 'Approves the PM’s own time. You by default.' : 'Approves the PM’s own time. Left empty, another principal of the firm.'} />

          </FormSection>
        )}
        {step === 2 && (
          <FormSection title="Review">
            <dl className="def-list">
              <dt>Code</dt><dd className="t-numeric">{form.code.trim()}</dd>
              <dt>Name</dt><dd>{form.name.trim()}</dd>
              <dt>Client</dt><dd>{clientLabel}</dd>
              <dt>PM</dt><dd>{nameOf(form.pm)}</dd>
              <dt>Principal</dt><dd>{principalLabel}</dd>
              <dt>Phases</dt><dd>{proposal ? `${phaseList.length} phases from the proposal` : template?.name ?? ''}</dd>
              <dt>Fee basis</dt><dd>{basisLabel(form.basis)}</dd>
              <dt>Fee</dt><dd className="t-numeric">{feeText}</dd>
              <dt>Team</dt><dd>{form.team.length ? <AvatarGroup size={20} names={form.team.map(nameOf)} /> : 'The PM only'}</dd>
            </dl>
          </FormSection>
        )}
      </Form>
    </Sheet>
  );
}

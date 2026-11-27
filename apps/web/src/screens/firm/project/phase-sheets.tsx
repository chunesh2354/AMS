/**
 * Live phase editing: the Phases tab's Edit sheet and the Timeline's "Set dates" sheet.
 * Three writes, and each is sent only when its fields changed:
 *   PUT /phases/:id/progress  ETC and delivery (first, because the server keeps status in step with progress)
 *   PUT /phases/:id           status, owner, hours budget, name
 *   PUT /phases/:id/dates     start and end, both or neither, with cascade for the phase's tasks
 */
import { useState } from 'react';
import { failureMessage } from '../../../api/live';
import { savePhaseProgress, updatePhase, type PhasePatch } from '../../../api/live/project-tabs';
import { HOURS_RANGE_ERROR, MAX_HOURS, PHASE_STATUSES, type LivePhase, type PhaseStatus } from '../../../api/live/projects';
import { putPhaseDates } from '../../../api/live/schedule';
import { Button } from '../../../ui/Button';
import { Checkbox } from '../../../ui/Checkbox';
import { DateField } from '../../../ui/DateField';
import { Form, FormSection } from '../../../ui/Form';
import { InlineAlert } from '../../../ui/InlineAlert';
import { NumberField } from '../../../ui/NumberField';
import { Select } from '../../../ui/Select';
import { Sheet } from '../../../ui/Sheet';
import { TextField } from '../../../ui/TextField';
import { useToast } from '../../../ui/Toast';

const NO_OWNER = '__no_owner__';

export type TeamOption = { id: string; name: string };
type Dates = { start: string | null; end: string | null };

/** Both or neither, and the start on or before the end. */
export function datesError(d: Dates): string | undefined {
  if (!!d.start !== !!d.end) return 'Set both dates, or clear both';
  if (d.start && d.end && d.start > d.end) return 'The end is before the start';
  return undefined;
}

/** Start and end pickers with a way to clear them: DateField itself can only pick a date. */
export function PhaseDateFields({ value, onChange, today, error }: { value: Dates; onChange: (d: Dates) => void; today: string; error?: string }) {
  return (
    <>
      <FormSection columns={2}>
        <DateField label="Start" value={value.start} onChange={(v) => onChange({ ...value, start: v })} today={today} placeholder="Not set" />
        <DateField label="End" value={value.end} onChange={(v) => onChange({ ...value, end: v })} today={today} placeholder="Not set" min={value.start ?? undefined} />
      </FormSection>
      {error && <p className="field__error" role="alert">{error}</p>}
      {(value.start || value.end) && (
        <div><Button variant="ghost" size="dense" onClick={() => onChange({ start: null, end: null })}>Clear dates</Button></div>
      )}
    </>
  );
}

const hoursError = (raw: string, allowEmpty: boolean) => {
  if (raw.trim() === '') return allowEmpty ? undefined : 'Enter hours, zero or more';
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= MAX_HOURS ? undefined : HOURS_RANGE_ERROR;
};
/** The status PUT /phases/:id/progress leaves a phase in: 100 closes it (unless Cancelled), any progress starts it, under 100 reopens it. */
export function statusAfterProgress(status: string, delivery: number): string {
  if (delivery >= 100 && status !== 'Cancelled') return 'Complete';
  if (delivery > 0 && status === 'Not started') return 'In progress';
  if (delivery < 100 && status === 'Complete') return 'In progress';
  return status;
}
const datesOf = (p: LivePhase): Dates => ({ start: p.start || null, end: p.end || null });

type Base = { status: string; ownerId: string | null; budget: number | null; name: string; etc: number; delivery: number; dates: Dates };
const baseOf = (p: LivePhase): Base => ({
  status: p.status, ownerId: p.owner?.id ?? null, budget: p.budgetHours, name: p.name, etc: p.etc, delivery: p.delivery, dates: datesOf(p),
});

/** The live Edit phase sheet. onSaved reloads the tab (also after a partial save, so the table shows what was kept). */
export function LiveEditPhaseSheet({ phase, team, today, onClose, onSaved }: {
  phase: LivePhase | null; team: TeamOption[]; today: string; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [shown, setShown] = useState<LivePhase | null>(null);
  const [base, setBase] = useState<Base | null>(null);
  const [status, setStatus] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [etc, setEtc] = useState('');
  const [delivery, setDelivery] = useState('');
  const [dates, setDates] = useState<Dates>({ start: null, end: null });
  const [cascade, setCascade] = useState(true);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (phase && phase !== shown && phase.id !== shown?.id) {
    const b = baseOf(phase);
    setShown(phase); setBase(b); setStatus(b.status); setOwner(b.ownerId); setName(b.name);
    setBudget(b.budget == null ? '' : String(b.budget)); setEtc(String(b.etc)); setDelivery(String(b.delivery));
    setDates(b.dates); setCascade(true); setTried(false); setFailure(null);
  }
  if (!phase && shown) setShown(null);

  // The owner choices: the project team, plus the current owner if they have left it.
  const options = [...team];
  if (phase?.owner && !options.some((o) => o.id === phase.owner!.id)) options.push({ id: phase.owner.id, name: phase.owner.name });

  const errors = {
    name: !name.trim() ? 'Name the phase' : name.trim().length > 120 ? 'Keep the name to 120 characters' : undefined,
    budget: hoursError(budget, true),
    etc: hoursError(etc, false),
    delivery: delivery.trim() === '' || !(Number(delivery) >= 0 && Number(delivery) <= 100) ? 'Enter 0 to 100' : undefined,
    dates: datesError(dates),
  };
  const invalid = Object.values(errors).some(Boolean);
  const err = (k: keyof typeof errors) => (tried ? errors[k] : undefined);

  const save = async () => {
    if (!phase || !base) return;
    if (invalid) { setTried(true); return; }
    let b = base;
    const budgetValue = budget.trim() === '' ? null : Number(budget);
    // The server rounds delivery to two decimals before it compares or stores it; so does the sheet.
    const deliveryValue = Math.round(Number(delivery) * 100) / 100;
    const progress = Number(etc) !== b.etc || deliveryValue !== b.delivery ? { etc: Number(etc), delivery: deliveryValue } : null;
    // The progress route moves the status itself (contract API 3), but only when the delivery figure changes; after it
    // the status to compare with is the synced one, since sending that same status again would be a self-transition
    // the server refuses. An ETC-only save leaves the status alone, so a requested status still goes.
    const synced = progress && progress.delivery !== b.delivery ? statusAfterProgress(b.status, progress.delivery) : b.status;
    const patch: PhasePatch = {};
    if (status !== b.status && status !== synced) patch.status = status as PhaseStatus;
    if (owner !== b.ownerId) patch.owner_id = owner;
    if (budgetValue !== b.budget) patch.budget_hours = budgetValue;
    if (name.trim() !== b.name) patch.name = name.trim();
    const moved = dates.start !== b.dates.start || dates.end !== b.dates.end;
    if (!progress && !Object.keys(patch).length && !moved) { onClose(); return; }
    setBusy(true); setFailure(null);
    let saved = false;
    try {
      if (progress) {
        await savePhaseProgress(phase.id, progress);
        saved = true; b = { ...b, ...progress, status: synced };
      }
      if (Object.keys(patch).length) {
        await updatePhase(phase.id, patch);
        saved = true;
        b = { ...b, status: patch.status ?? b.status, ownerId: 'owner_id' in patch ? patch.owner_id ?? null : b.ownerId, budget: 'budget_hours' in patch ? budgetValue : b.budget, name: patch.name ?? b.name };
      }
      if (moved) {
        await putPhaseDates(phase.id, { start_date: dates.start, end_date: dates.end, cascade: b.dates.start && dates.start ? cascade : false });
        saved = true; b = { ...b, dates };
      }
      const onlyProgress = !!progress && !Object.keys(patch).length && !moved;
      toast({ variant: 'success', message: onlyProgress ? `${name.trim()} progress saved.` : `${name.trim()} saved.` });
      onClose();
      onSaved();
    } catch (e) {
      // Keep the sheet open on what is left to save; what was saved already is not sent again.
      setBase(b);
      setFailure(failureMessage(e));
      if (saved) onSaved();
    } finally { setBusy(false); }
  };

  const dirty = !!base && (status !== base.status || owner !== base.ownerId || name !== base.name || etc !== String(base.etc) || delivery !== String(base.delivery)
    || budget !== (base.budget == null ? '' : String(base.budget)) || dates.start !== base.dates.start || dates.end !== base.dates.end);
  const datesMoved = !!base && (dates.start !== base.dates.start || dates.end !== base.dates.end);
  return (
    <Sheet
      open={!!phase} onClose={onClose} title="Edit phase" description={phase?.name} dirty={dirty && !busy} size={640}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => { void save(); }}>Save phase</Button></>}
    >
      {failure && <InlineAlert variant="danger" title={failure} />}
      {phase && (
        <Form onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <FormSection columns={2}>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={err('name')} />
            <Select label="Status" options={PHASE_STATUSES.map((s) => ({ value: s, label: s }))} value={status} onChange={setStatus} />
            <Select
              label="Owner" value={owner ?? NO_OWNER} onChange={(v) => setOwner(v === NO_OWNER ? null : v)}
              options={[{ value: NO_OWNER, label: 'No owner' }, ...options.map((o) => ({ value: o.id, label: o.name }))]}
              helper="The project’s PM and team."
            />
            <NumberField label="Hours budget (h)" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No budget" error={err('budget')} helper={`Leave empty for no budget. At most ${MAX_HOURS} h.`} />
          </FormSection>
          <PhaseDateFields value={dates} onChange={setDates} today={today} error={err('dates')} />
          {datesMoved && base?.dates.start && dates.start && (
            <Checkbox label="Move this phase’s tasks too" checked={cascade} onChange={(e) => setCascade(e.target.checked)} description="Open tasks shift by the same number of days." />
          )}
          <FormSection columns={2}>
            <NumberField label="ETC (h)" value={etc} onChange={(e) => setEtc(e.target.value)} error={err('etc')} />
            <NumberField label="Delivery (%)" value={delivery} onChange={(e) => setDelivery(e.target.value)} error={err('delivery')} />
          </FormSection>
        </Form>
      )}
    </Sheet>
  );
}

/** The Timeline's "Set dates": a phase's start and end only, through PUT /phases/:id/dates. */
export function PhaseDatesSheet({ phase, today, onClose, onSaved }: {
  phase: { id: string; name: string; start: string | null; end: string | null } | null; today: string; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [shown, setShown] = useState<string | null>(null);
  const [dates, setDates] = useState<Dates>({ start: null, end: null });
  const [cascade, setCascade] = useState(true);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (phase && phase.id !== shown) { setShown(phase.id); setDates({ start: phase.start, end: phase.end }); setCascade(true); setTried(false); setFailure(null); }
  if (!phase && shown) setShown(null);
  const error = !dates.start && !dates.end ? 'Pick a start and an end' : datesError(dates);
  const save = async () => {
    if (!phase) return;
    if (error) { setTried(true); return; }
    setBusy(true); setFailure(null);
    try {
      await putPhaseDates(phase.id, { start_date: dates.start, end_date: dates.end, cascade: phase.start && dates.start ? cascade : false });
      toast({ variant: 'success', message: `${phase.name} dates saved.` });
      onClose();
      onSaved();
    } catch (e) {
      setFailure(failureMessage(e));
    } finally { setBusy(false); }
  };
  return (
    <Sheet
      open={!!phase} onClose={onClose} title="Set phase dates" description={phase?.name} dirty={!!(dates.start || dates.end) && !busy}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => { void save(); }}>Save dates</Button></>}
    >
      {failure && <InlineAlert variant="danger" title={failure} />}
      <Form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <PhaseDateFields value={dates} onChange={setDates} today={today} error={tried ? error : undefined} />
        {phase?.start && dates.start && <Checkbox label="Move this phase’s tasks too" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />}
      </Form>
    </Sheet>
  );
}

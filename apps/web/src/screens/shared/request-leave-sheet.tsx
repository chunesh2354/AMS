import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { getAffectedAssignments } from '../../api';
import { failureMessage, isLive } from '../../api/live';
import { todayIn } from '../../api/live/time';
import { announceLeaveChanged, liveMyLeave, submitLeave, type LiveLeaveType } from '../../api/live/leave';
import { TODAY } from '../../mock/studio-meridian';
import { Button } from '../../ui/Button';
import { DateRangeField, type DateRange } from '../../ui/DateRangeField';
import { Form, FormSection } from '../../ui/Form';
import { Segmented } from '../../ui/Segmented';
import { Select } from '../../ui/Select';
import { Sheet } from '../../ui/Sheet';
import { TextArea } from '../../ui/TextArea';
import { useToast } from '../../ui/Toast';
import { formatHours, parseISO } from '../../ui/format';

const TYPES = ['Earned leave', 'Casual leave', 'Sick leave'];
type Unit = 'full' | 'half';

const workingDays = (r: DateRange) => {
  if (!r.from || !r.to) return 0;
  let n = 0;
  for (let d = parseISO(r.from); d <= parseISO(r.to); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) if (d.getDay() % 6 !== 0) n += 1;
  return n;
};

/** Section 9.3. Shows what the leave affects before anything is submitted. */
export function RequestLeaveSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [type, setType] = useState<string | null>(TYPES[0]);
  const [range, setRange] = useState<DateRange>({ from: null, to: null });
  const [unit, setUnit] = useState<Unit>('full');
  const [handover, setHandover] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  // Live: the studio's leave types and today come from GET /me/leave; the request goes to POST /leave-requests.
  const [live, setLive] = useState<{ types: LiveLeaveType[]; today: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setType(TYPES[0]); setRange({ from: null, to: null }); setUnit('full'); setHandover(''); setReason(''); setTried(false); } }, [open]);
  useEffect(() => {
    if (!open || !isLive) return;
    let on = true;
    liveMyLeave().then((d) => { if (on) { setLive({ types: d.types, today: d.today }); setType(d.types[0]?.id ?? null); } }, () => { if (on) setLive({ types: [], today: todayIn() }); });
    return () => { on = false; };
  }, [open]);

  const days = workingDays(range);
  const hours = days * (unit === 'full' ? 8 : 4);
  const valid = !!range.from && !!range.to && days > 0 && !!type;
  // No endpoint lists affected assignments yet: live mode leaves the section out rather than show sample data.
  const affected = valid && !isLive ? getAffectedAssignments() : [];
  const today = isLive ? live?.today ?? todayIn() : TODAY;
  const options = isLive ? (live?.types ?? []).map((t) => ({ value: t.id, label: t.name })) : TYPES.map((t) => ({ value: t, label: t }));
  const submit = () => {
    if (!valid) { setTried(true); return; }
    if (isLive) {
      if (!type || !range.from || !range.to) return;
      setSaving(true);
      submitLeave({ leave_type_id: type, start_date: range.from, end_date: range.to, half_day: unit === 'half', reason: reason.trim() || undefined, handover_note: handover.trim() || undefined }).then(
        (r) => {
          toast({ variant: 'success', message: `Leave requested for ${formatHours(Number(r.hours))}. ${r.approver ? `${r.approver.name} decides.` : ''}`.trim() });
          announceLeaveChanged();
          onClose();
        },
        (e) => toast({ variant: 'danger', message: failureMessage(e) }),
      ).finally(() => setSaving(false));
      return;
    }
    toast({ variant: 'success', message: `Leave request ready for ${formatHours(hours)}. Nothing is saved in this demo.` });
    onClose();
  };
  return (
    <Sheet
      open={open} onClose={onClose} title="Request leave" dirty={!!range.from || handover !== '' || reason !== ''}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving} onClick={submit}>Submit request</Button></>}
    >
      <Form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormSection>
          <Select label="Type" options={options} value={type} onChange={setType} />
          <DateRangeField label="Dates" value={range} onChange={setRange} today={today} min={today} error={tried && !valid ? 'Choose working days' : undefined} />
          <div className="field"><span className="field__label">Unit</span><Segmented label="Unit" value={unit} onChange={setUnit} options={[{ value: 'full', label: 'Full day' }, { value: 'half', label: 'Half day' }]} /></div>
          <dl className="calc"><dt>Computed</dt><dd className="calc__strong">{formatHours(hours)}</dd></dl>
        </FormSection>
        {!isLive && (
          <FormSection title="Affected assignments">
            {affected.length
              ? <ul className="link-list">{affected.map((a) => <li key={a.what}><span>{a.what}</span><span className="t-numeric">{formatHours(a.hours)}</span></li>)}</ul>
              : <p className="t-body-sm ink-2">Choose dates to see what this affects.</p>}
          </FormSection>
        )}
        <FormSection>
          <TextArea label="Handover note" rows={2} value={handover} onChange={(e) => setHandover(e.target.value)} />
          <TextArea label="Private reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} helper={<span className="prio"><Lock size={14} strokeWidth={1.5} aria-hidden />Only your approver can see this.</span>} />
        </FormSection>
      </Form>
    </Sheet>
  );
}

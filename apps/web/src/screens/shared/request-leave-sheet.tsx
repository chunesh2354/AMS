import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { getAffectedAssignments } from '../../api';
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
  useEffect(() => { if (open) { setType(TYPES[0]); setRange({ from: null, to: null }); setUnit('full'); setHandover(''); setReason(''); setTried(false); } }, [open]);

  const days = workingDays(range);
  const hours = days * (unit === 'full' ? 8 : 4);
  const valid = !!range.from && !!range.to && days > 0;
  const affected = valid ? getAffectedAssignments() : [];
  const submit = () => {
    if (!valid) { setTried(true); return; }
    toast({ variant: 'success', message: `Leave request ready for ${formatHours(hours)}. Nothing is saved in this demo.` });
    onClose();
  };
  return (
    <Sheet
      open={open} onClose={onClose} title="Request leave" dirty={!!range.from || handover !== '' || reason !== ''}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Submit request</Button></>}
    >
      <Form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormSection>
          <Select label="Type" options={TYPES.map((t) => ({ value: t, label: t }))} value={type} onChange={setType} />
          <DateRangeField label="Dates" value={range} onChange={setRange} today={TODAY} min={TODAY} error={tried && !valid ? 'Choose working days' : undefined} />
          <div className="field"><span className="field__label">Unit</span><Segmented label="Unit" value={unit} onChange={setUnit} options={[{ value: 'full', label: 'Full day' }, { value: 'half', label: 'Half day' }]} /></div>
          <dl className="calc"><dt>Computed</dt><dd className="calc__strong">{formatHours(hours)}</dd></dl>
        </FormSection>
        <FormSection title="Affected assignments">
          {affected.length
            ? <ul className="link-list">{affected.map((a) => <li key={a.what}><span>{a.what}</span><span className="t-numeric">{formatHours(a.hours)}</span></li>)}</ul>
            : <p className="t-body-sm ink-2">Choose dates to see what this affects.</p>}
        </FormSection>
        <FormSection>
          <TextArea label="Handover note" rows={2} value={handover} onChange={(e) => setHandover(e.target.value)} />
          <TextArea label="Private reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} helper={<span className="prio"><Lock size={14} strokeWidth={1.5} aria-hidden />Only your approver can see this.</span>} />
        </FormSection>
      </Form>
    </Sheet>
  );
}

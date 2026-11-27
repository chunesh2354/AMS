import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { failureMessage } from '../../api/live';
import { setProjectStatus, statusMoves, type ProjectPermissions, type StatusMove } from '../../api/live/projects';
import { Button } from '../../ui/Button';
import { Form, FormSection } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { Menu } from '../../ui/Menu';
import { Sheet } from '../../ui/Sheet';
import { TextArea } from '../../ui/TextArea';
import { useToast } from '../../ui/Toast';

const MAX_REASON = 500;
/**
 * What archiving really does: GET /projects/health, /overview, /schedule (studio timeline, unless asked for Archived)
 * and planning leave Archived projects out, and new time on them is refused. GET /projects still lists them.
 */
const ARCHIVE_HELPER = 'Archived projects leave Health, the overview, the studio timeline and the planning calendar, and take no new time or new allocations. They stay in the Projects list, and Restore brings one back.';

const DONE: Record<StatusMove['to'], string> = {
  Active: 'is active again', 'On hold': 'is on hold', 'Delivery complete': 'is marked delivery complete', Archived: 'is archived',
};

/** The reason sheet for On hold and Archive: the server needs 1 to 500 characters. */
function ReasonSheet({ code, move, onClose, onDone }: { code: string; move: StatusMove | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [shown, setShown] = useState<StatusMove | null>(null);
  if (move && move !== shown) { setShown(move); setReason(''); setTried(false); setFailure(null); }
  if (!move && shown) setShown(null);
  const text = reason.trim();
  const error = !text ? (move?.to === 'Archived' ? 'Say why the project is archived' : 'Say why the project is on hold')
    : text.length > MAX_REASON ? `Keep it to ${MAX_REASON} characters` : undefined;
  const save = async () => {
    if (!move) return;
    if (error) { setTried(true); return; }
    setBusy(true); setFailure(null);
    try {
      await setProjectStatus(code, { status: move.to, reason: text });
      toast({ variant: 'success', message: `${code} ${DONE[move.to]}.` });
      onClose();
      onDone();
    } catch (e) {
      setFailure(failureMessage(e));
    } finally { setBusy(false); }
  };
  const archive = move?.to === 'Archived';
  return (
    <Sheet
      open={!!move} onClose={onClose} title={archive ? 'Archive project' : 'Put project on hold'} description={code} dirty={!!reason && !busy}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => { void save(); }}>{archive ? 'Archive project' : 'Put on hold'}</Button></>}
    >
      {failure && <InlineAlert variant="danger" title={failure} />}
      <Form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <FormSection>
          <TextArea
            label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={MAX_REASON}
            helper={archive ? ARCHIVE_HELPER : 'Shown on the project and told to the team. Allocations are kept.'}
            error={tried ? error : undefined}
          />
        </FormSection>
      </Form>
    </Sheet>
  );
}

/**
 * "Project status" in the project header: only the moves valid from the current status that the server allows this viewer.
 * On hold and Archive ask for a reason first. onChanged reloads the header and the tab.
 */
export function ProjectStatusMenu({ code, status, permissions, onChanged }: { code: string; status: string; permissions: ProjectPermissions; onChanged: () => void }) {
  const toast = useToast();
  const [asking, setAsking] = useState<StatusMove | null>(null);
  const [busy, setBusy] = useState(false);
  const moves = statusMoves(status, permissions);
  if (!permissions.change_status && !permissions.archive) return null;
  const run = async (m: StatusMove) => {
    if (m.needsReason) { setAsking(m); return; }
    setBusy(true);
    try {
      await setProjectStatus(code, { status: m.to });
      toast({ variant: 'success', message: `${code} ${DONE[m.to]}.` });
      onChanged();
    } catch (e) {
      toast({ variant: 'danger', message: failureMessage(e) });
    } finally { setBusy(false); }
  };
  return (
    <>
      <Menu
        label="Project status" placement="bottom-end"
        items={moves.length ? moves.map((m) => ({ label: m.label, onSelect: () => { void run(m); } })) : [{ type: 'heading', label: 'No change available' }]}
        trigger={(p) => <Button {...p} loading={busy} icon={<ChevronDown size={16} strokeWidth={1.5} aria-hidden />}>Project status</Button>}
      />
      <ReasonSheet code={code} move={asking} onClose={() => setAsking(null)} onDone={onChanged} />
    </>
  );
}

import { Fragment, useEffect, useState } from 'react';
import { ApiFailure, failureMessage, isRestricted, rupees } from '../../../api/live';
import { getFeePlan, saveProjectFees, type FeePlanPhase } from '../../../api/live/project-tabs';
import { Button } from '../../../ui/Button';
import { InlineAlert } from '../../../ui/InlineAlert';
import { MoneyField } from '../../../ui/MoneyField';
import { useToast } from '../../../ui/Toast';
import { formatINR } from '../../../ui/format';

const paise = (v: number) => Math.round(v * 100);

/** What is authorized on a phase already, in rupees: its fee cannot go below this. */
export const authorizedFloor = (fee: number, authorizedPercent: number) => Math.round(fee * authorizedPercent) / 100;

/**
 * Checks a fee edit before it is sent: the contracted fee above zero, a fee for every phase, nothing below what is
 * authorized, and the phase fees adding up to the contracted fee (in paise). Returns the first problem, else null.
 */
export function feeEditError(contracted: number | null, phases: { name: string; fee: number | null; floor: number }[]): string | null {
  if (!(contracted != null && contracted > 0)) return 'Enter the contracted fee.';
  const missing = phases.find((p) => p.fee == null || p.fee < 0);
  if (missing) return `Enter a fee for ${missing.name}.`;
  const low = phases.find((p) => paise(p.fee!) < paise(p.floor));
  if (low) return `${low.name} has ${formatINR(low.floor)} authorized already. Its fee cannot go below that.`;
  const sum = phases.reduce((s, p) => s + paise(p.fee!), 0);
  if (sum !== paise(contracted)) return `Phase fees add up to ${formatINR(sum / 100)}. They must add up to the fee of ${formatINR(contracted)}.`;
  return null;
}

/**
 * Live Billing tab: a fixed fee's contracted amount and phase fees (PUT /projects/:code/fees). A project created
 * without fees cannot be authorized or billed, so it opens ready to edit. Shown only to people who may change fees.
 */
export function ProjectFeesEditor({ code, mayEdit, onSaved }: { code: string; mayEdit: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [phases, setPhases] = useState<FeePlanPhase[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [contracted, setContracted] = useState<number | null>(null);
  const [fees, setFees] = useState<Record<string, number | null>>({});
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!mayEdit) return;
    let live = true;
    getFeePlan(code).then(
      (p) => {
        if (!live) return;
        const fixed = p.phases.filter((x) => x.fixed);
        setPhases(fixed); setLoadError(null);
        const total = fixed.reduce((s, x) => s + (isRestricted(x.fee) ? 0 : rupees(x.fee) ?? 0), 0);
        if (fixed.length && total === 0) setEditing(true);
      },
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiFailure && (e.status === 403 || e.status === 404)) setPhases([]);
        else setLoadError(failureMessage(e));
      },
    );
    return () => { live = false; };
  }, [code, mayEdit, attempt]);

  if (!mayEdit || (phases && !phases.length)) return null;
  if (loadError) return <InlineAlert variant="danger" title={loadError} />;
  if (!phases || phases.some((p) => isRestricted(p.fee))) return null;

  const feeOf = (p: FeePlanPhase) => (isRestricted(p.fee) ? 0 : rupees(p.fee) ?? 0);
  const total = phases.reduce((s, p) => s + paise(feeOf(p)), 0) / 100;
  const startEdit = () => {
    setContracted(total > 0 ? total : null);
    setFees(Object.fromEntries(phases.map((p) => [p.phase_id, total > 0 ? feeOf(p) : null])));
    setTried(false); setServerError(null); setEditing(true);
  };
  const rows = phases.map((p) => ({ name: p.name, fee: fees[p.phase_id] ?? null, floor: authorizedFloor(feeOf(p), p.authorized_percent) }));
  const error = feeEditError(contracted, rows);

  const save = async () => {
    setTried(true);
    if (error) return;
    setBusy(true); setServerError(null);
    try {
      await saveProjectFees(code, { contracted_amount: contracted!, phases: phases.map((p) => ({ phase_id: p.phase_id, fee: fees[p.phase_id]! })) });
      toast({ variant: 'success', message: `Fees saved. ${formatINR(contracted!)} across ${phases.length} phases.` });
      setEditing(false);
      setAttempt((a) => a + 1);
      onSaved();
    } catch (e) { setServerError(failureMessage(e)); } finally { setBusy(false); }
  };

  return (
    <section className="card solid-panel stack-4" aria-labelledby="fees-title">
      <div className="toolbar toolbar--between">
        <h3 id="fees-title" className="t-h3">Fees</h3>
        {!editing && <Button size="dense" onClick={startEdit}>Edit fees</Button>}
      </div>
      {total === 0 && <p className="t-body-sm ink-2">This fixed fee has no phase fees yet, so nothing on it can be authorized or billed. Set them here.</p>}
      {serverError && <InlineAlert variant="danger" title={serverError} />}
      {editing
        ? (
          <div className="stack-4" role="group" aria-label="Edit fees">
            <MoneyField label="Contracted fee" value={contracted} onChange={setContracted} />
            {phases.map((p, i) => (
              <MoneyField
                key={p.phase_id} dense label={`${p.name} fee`} value={fees[p.phase_id] ?? null} onChange={(v) => setFees((f) => ({ ...f, [p.phase_id]: v }))}
                helper={rows[i]!.floor > 0 ? `At least ${formatINR(rows[i]!.floor)}, already authorized` : undefined}
              />
            ))}
            {tried && error
              ? <p className="field__error" role="alert">{error}</p>
              : <p className="t-caption ink-2">Phase fees add up to <span className="t-numeric">{formatINR(rows.reduce((s, r) => s + paise(r.fee ?? 0), 0) / 100)}</span>.</p>}
            <div className="toolbar">
              <Button variant="primary" size="dense" loading={busy} onClick={() => void save()}>Save fees</Button>
              {total > 0 && <Button variant="ghost" size="dense" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>}
            </div>
          </div>
        )
        : (
          <dl className="def-list">
            <dt>Contracted fee</dt><dd className="t-numeric">{formatINR(total)}</dd>
            {phases.map((p) => <Fragment key={p.phase_id}><dt>{p.name}</dt><dd className="t-numeric">{formatINR(feeOf(p))}</dd></Fragment>)}

          </dl>
        )}
    </section>
  );
}

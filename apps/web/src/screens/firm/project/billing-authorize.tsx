import { useEffect, useState } from 'react';
import { ApiFailure, failureMessage, isRestricted, rupees, type LiveMoney, type Restricted } from '../../../api/live';
import { authorizeFee, authorizeMilestone, createMilestone, getFeePlan, type FeePlan, type FeePlanPhase } from '../../../api/live/project-tabs';
import { Button } from '../../../ui/Button';
import { InlineAlert } from '../../../ui/InlineAlert';
import { MoneyField } from '../../../ui/MoneyField';
import { PercentField } from '../../../ui/PercentField';
import { RestrictedCell } from '../../../ui/RestrictedCell';
import { StatusChip } from '../../../ui/StatusChip';
import { TextField } from '../../../ui/TextField';
import { useToast } from '../../../ui/Toast';
import { formatINR } from '../../../ui/format';
import type { Status } from '../../../ui/status-colors';

const SCHEDULED = ['fixed_milestone', 'percent_construction'];
const HOURLY = ['hourly', 'hourly_nte'];

/**
 * "40", "40.5", "33.33": a level above the current one and at most 100, with at most two decimals, else null.
 * n * 100 is not exact in floating point (1.1 * 100 = 110.00000000000001), so two decimals is checked with a tolerance.
 */
export function nextLevel(input: string, current: number): number | null {
  const n = input.trim() === '' ? NaN : Number(input);
  if (!Number.isFinite(n) || n <= current || n > 100 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return null;
  return n;
}

/**
 * Live Billing tab: the sources a new project needs before anything is ready to bill. A principal authorizes fixed-fee
 * progress per phase and authorizes milestones; hourly work needs only approved time. `showMoney` follows the same
 * rule as the rest of the tab. Hidden when the server has no plan for this viewer (403 or 404).
 */
export function FeeAuthorizationPanel({ code, showMoney, mayPrepare, onChanged }: { code: string; showMoney: boolean; mayPrepare: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState<FeePlan | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [levels, setLevels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    getFeePlan(code).then(
      (p) => { if (live) { setPlan(p); setHidden(false); setLoadError(null); } },
      (e: unknown) => {
        if (!live) return;
        if (e instanceof ApiFailure && (e.status === 403 || e.status === 404)) setHidden(true);
        else setLoadError(failureMessage(e));
      },
    );
    return () => { live = false; };
  }, [code, attempt]);

  if (hidden) return null;
  if (loadError) return <InlineAlert variant="danger" title={loadError} />;
  if (!plan) return null;

  const inr = (m: LiveMoney | Restricted) => (!showMoney || isRestricted(m) ? <RestrictedCell /> : formatINR(rupees(m) ?? 0));
  const feeOf = (p: FeePlanPhase) => (isRestricted(p.fee) ? null : rupees(p.fee));
  const fixed = plan.phases.filter((p) => p.fixed && (feeOf(p) ?? 1) > 0);
  const scheduled = plan.components.some((c) => SCHEDULED.includes(c.billing_method));
  const hourly = plan.components.some((c) => HOURLY.includes(c.billing_method));
  const done = () => { setAttempt((a) => a + 1); onChanged(); };

  const authorize = async (p: FeePlanPhase, pct: number) => {
    setBusy(p.phase_id); setError(null);
    try {
      await authorizeFee(code, { phase_id: p.phase_id, cumulative_percent: pct });
      setLevels((l) => ({ ...l, [p.phase_id]: '' }));
      toast({ variant: 'success', message: `Authorized ${pct}% of ${p.name}. It is in Ready to bill.` });
      done();
    } catch (e) { setError(failureMessage(e)); } finally { setBusy(null); }
  };
  const authorizeOne = async (id: string, name: string) => {
    setBusy(id); setError(null);
    try {
      await authorizeMilestone(id);
      toast({ variant: 'success', message: `${name} authorized. It is in Ready to bill.` });
      done();
    } catch (e) { setError(failureMessage(e)); } finally { setBusy(null); }
  };
  const addMilestone = async () => {
    if (!label.trim() || !(amount != null && amount > 0)) { setError('Name the milestone and enter an amount above zero.'); return; }
    setBusy('milestone'); setError(null);
    try {
      await createMilestone(code, { label: label.trim(), amount });
      setLabel(''); setAmount(null);
      toast({ variant: 'success', message: `${label.trim()} added. Authorize it to bill it.` });
      done();
    } catch (e) { setError(failureMessage(e)); } finally { setBusy(null); }
  };

  return (
    <section className="card solid-panel stack-4" aria-labelledby="fee-auth-title">
      <div className="toolbar toolbar--between">
        <h3 id="fee-auth-title" className="t-h3">Authorize fee for billing</h3>
        {!plan.can_authorize && (fixed.length > 0 || plan.milestones.length > 0) && <span className="t-caption ink-2">A principal authorizes progress and milestones.</span>}
      </div>
      {error && <InlineAlert variant="danger" title={error} />}
      {hourly && <p className="t-body-sm ink-2">Hourly work is billed from approved time at each person’s bill rate. Approved hours appear in Ready to bill.</p>}
      {fixed.length > 0 && (
        <div className="stack-rows" role="list" aria-label="Fixed fee by phase">
          {fixed.map((p) => {
            const input = levels[p.phase_id] ?? '';
            const pct = nextLevel(input, p.authorized_percent);
            const fee = feeOf(p);
            const release = pct != null && fee != null ? Math.round(fee * (pct - p.authorized_percent)) / 100 : null;
            return (
              <div key={p.phase_id} role="listitem" className="toolbar toolbar--between">
                <span>
                  <span className="t-body">{p.name}</span>{' '}
                  <span className="t-caption ink-2">Fee {inr(p.fee)}. Authorized <span className="t-numeric">{p.authorized_percent}%</span>.</span>
                </span>
                {plan.can_authorize && p.authorized_percent < 100 && (
                  <span className="toolbar">
                    <PercentField
                      label={`New level for ${p.name}`} dense value={input} onChange={(e) => setLevels((l) => ({ ...l, [p.phase_id]: e.target.value }))}
                      error={input.trim() !== '' && pct == null ? `Above ${p.authorized_percent}% and at most 100%` : undefined}
                      helper={release != null && showMoney ? `Entitlement rises by ${formatINR(release)}` : undefined}
                    />
                    <Button variant="primary" size="dense" disabled={pct == null} loading={busy === p.phase_id} onClick={() => pct != null && void authorize(p, pct)}>
                      {pct != null ? `Authorize ${pct}% of ${p.name}` : `Authorize ${p.name}`}
                    </Button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {scheduled && (
        <div className="stack-rows" role="list" aria-label="Milestones">
          {plan.milestones.length === 0 && <p className="t-body-sm ink-2">No milestones yet. Add one, then authorize it to bill it.</p>}
          {plan.milestones.map((m) => (
            <div key={m.id} role="listitem" className="toolbar toolbar--between">
              <span><span className="t-body">{m.label}</span> <span className="t-caption ink-2">{inr(m.amount)}{m.phase ? `, ${m.phase}` : ''}</span></span>
              <span className="toolbar">
                <StatusChip size="sm" status={m.status as Status} />
                {plan.can_authorize && m.status === 'Planned' && (
                  <Button variant="primary" size="dense" loading={busy === m.id} onClick={() => void authorizeOne(m.id, m.label)}>{`Authorize ${m.label}`}</Button>
                )}
              </span>
            </div>
          ))}
          {(plan.can_authorize || mayPrepare) && (
            <div className="toolbar">
              <TextField label="Milestone" dense value={label} onChange={(e) => setLabel(e.target.value)} />
              <MoneyField label="Amount" dense value={amount} onChange={setAmount} />
              <Button size="dense" loading={busy === 'milestone'} onClick={() => void addMilestone()}>Add milestone</Button>
            </div>
          )}
        </div>
      )}
      {!hourly && !scheduled && fixed.length === 0 && <p className="t-body-sm ink-2">No phase has a fixed fee yet, so there is nothing to authorize.</p>}
    </section>
  );
}

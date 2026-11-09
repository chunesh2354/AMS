import { useEffect, useState } from 'react';
import { failureMessage, isLive } from '../../api/live';
import { getApprovalSettings, saveFallbackApprover, type ApprovalSettingsPerson, type LiveApprovalSettings } from '../../api/live/approvals';
import { PEOPLE } from '../../mock/studio-meridian';
import { Button } from '../../ui/Button';
import { Form, FormFooter, FormSection } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { ListStateBlock } from '../../ui/ListState';
import { PersonPicker } from '../../ui/PersonPicker';
import { useToast } from '../../ui/Toast';

/** Mock mode: the sample studio, with Asha Rao as the fallback and everyone who approves time to choose from. */
const mockSettings = (): LiveApprovalSettings => {
  const candidates = PEOPLE.filter((p) => p.roles.includes('principal') || p.roles.includes('pm'))
    .map((p) => ({ id: p.id, ref_code: p.id, name: p.name, job_title: p.title }));
  return { fallback_approver: candidates.find((p) => p.ref_code === 'P01') ?? null, fallback_approver_eligible: true, allow_self_approval: false, candidates };
};

const ROUTING_NOTE = 'Time goes to the project manager; a manager\'s own time goes to the project principal. When that is the person who submitted it, '
  + 'it goes to the fallback approver, then to any other principal. If nobody else can approve, a sole principal approves their own time, '
  + 'recorded as a self-approval, and anyone else is asked to have an approver set here.';

/** Settings, Approvals: the firm's fallback approver (PUT /firm/approvals-settings), chosen from active people who hold time.approve. */
export function ApprovalsSettings() {
  const toast = useToast();
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'denied'>('loading');
  const [loadError, setLoadError] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [settings, setSettings] = useState<LiveApprovalSettings | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setState('loading');
    (isLive ? getApprovalSettings() : Promise.resolve(mockSettings())).then((s) => {
      if (!current) return;
      setSettings(s);
      setChoice(s.fallback_approver?.id ?? null);
      setState('ready');
    }, (e: unknown) => {
      if (!current) return;
      const status = (e as { status?: number }).status;
      setLoadError(failureMessage(e));
      setState(status === 403 ? 'denied' : 'error');
    });
    return () => { current = false; };
  }, [attempt]);

  if (state !== 'ready' || !settings) {
    return <ListStateBlock state={state === 'ready' ? 'loading' : state} label="Approval settings" errorMessage={loadError} onRetry={() => setAttempt((n) => n + 1)} capability="change firm settings" rows={3} />;
  }

  const people = settings.candidates.map((p: ApprovalSettingsPerson) => ({ id: p.id, name: p.name, title: p.job_title ?? p.ref_code }));
  const stored = settings.fallback_approver?.id ?? null;
  const changed = choice !== stored;
  const save = async () => {
    setSaveError(null);
    const name = people.find((p) => p.id === choice)?.name;
    if (!isLive) {
      setSettings({ ...settings, fallback_approver: settings.candidates.find((p) => p.id === choice) ?? null, fallback_approver_eligible: choice ? true : null });
      toast({ variant: 'success', message: `${choice ? `${name} is the fallback approver` : 'Fallback approver cleared'}. Nothing is saved in this demo.` });
      return;
    }
    setSaving(true);
    try {
      const r = await saveFallbackApprover(choice);
      setSettings({ ...settings, fallback_approver: r.fallback_approver, fallback_approver_eligible: r.fallback_approver_eligible });
      toast({ variant: 'success', message: choice ? `${name} is now the fallback approver.` : 'Fallback approver cleared.' });
    } catch (e) {
      setSaveError(failureMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="solid-panel settings__panel">
      <Form onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <FormSection title="Approvals">
          <p className="t-body-sm ink-2">{ROUTING_NOTE}</p>
          {settings.fallback_approver && settings.fallback_approver_eligible === false && (
            <InlineAlert variant="warn" title={`${settings.fallback_approver.name} can no longer approve time`}>Routing skips them. Choose someone else.</InlineAlert>
          )}
          <PersonPicker
            label="Fallback approver" value={choice} onChange={setChoice} people={people}
            helper="Only active people who can approve time are listed."
            empty="Nobody else can approve time yet."
          />
          {saveError && <InlineAlert variant="danger" title="Not saved">{saveError}</InlineAlert>}
        </FormSection>
        <FormFooter>
          {choice && <Button variant="ghost" onClick={() => setChoice(null)}>Clear</Button>}
          <Button variant="primary" type="submit" disabled={!changed || saving}>{saving ? 'Saving' : 'Save'}</Button>
        </FormFooter>
      </Form>
    </div>
  );
}

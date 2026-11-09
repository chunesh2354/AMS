import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getPerson, getWorkingPattern, personName } from '../../api';
import { ApiFailure, failureMessage, isLive } from '../../api/live';
import { changePassword } from '../../api/live/password';
import { useResource } from '../../api/useResource';
import { useSession } from '../../app/session';
import { SettingsLayout } from '../../layouts/SettingsLayout';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { EffectiveDatedList } from '../../ui/EffectiveDatedList';
import { Form, FormFooter, FormSection } from '../../ui/Form';
import { ListStateBlock } from '../../ui/ListState';
import { PageHeader } from '../../ui/PageHeader';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { GoTo } from '../shared/go-to';
import { MIN_PASSWORD } from '../auth/accept-invite';
import { InlineAlert } from '../../ui/InlineAlert';

function Personal({ name }: { name: string }) {
  const toast = useToast();
  const [display, setDisplay] = useState(name);
  const [phone, setPhone] = useState('');
  const [emergency, setEmergency] = useState('');
  const [tried, setTried] = useState(false);
  const badPhone = phone !== '' && !/^\+?[0-9 ]{8,15}$/.test(phone);
  const save = () => {
    if (!display.trim() || badPhone) { setTried(true); return; }
    toast({ variant: 'success', message: 'Your details are checked. Nothing is saved in this demo.' });
  };
  return (
    <div className="solid-panel settings__panel">
      <Form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormSection title="Personal details">
          <TextField label="Display name" value={display} onChange={(e) => setDisplay(e.target.value)} error={tried && !display.trim() ? 'Enter a name' : undefined} />
          <TextField label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} error={tried && badPhone ? 'Enter a phone number with 8 to 15 digits' : undefined} />
          <TextField label="Emergency contact" value={emergency} onChange={(e) => setEmergency(e.target.value)} helper="Only you and operations can see these." />
        </FormSection>
        <FormFooter><Button variant="primary" onClick={save}>Save</Button></FormFooter>
      </Form>
    </div>
  );
}

const BLANK_PASSWORDS = { current: '', next: '', confirm: '' };

/** Signed-in password change. The server checks the current password and signs out every other session. */
export function ChangePassword() {
  const toast = useToast();
  const [form, setForm] = useState(BLANK_PASSWORDS);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wrongCurrent, setWrongCurrent] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (k: keyof typeof BLANK_PASSWORDS, v: string) => { setForm((f) => ({ ...f, [k]: v })); if (k === 'current') setWrongCurrent(null); };

  const errors = {
    current: !form.current ? 'Enter your current password' : wrongCurrent ?? undefined,
    next: form.next.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters` : form.next === form.current ? 'Choose a password different from your current one' : undefined,
    confirm: !form.confirm ? 'Enter the new password again' : form.confirm !== form.next ? 'The passwords do not match' : undefined,
  };
  const show = (k: keyof typeof errors) => (tried || (k === 'current' && wrongCurrent) ? errors[k] : undefined);

  const save = async () => {
    setTried(true);
    setFailure(null);
    if (errors.current || errors.next || errors.confirm) return;
    if (!isLive) { toast({ variant: 'success', message: 'Your new password is checked. Nothing is saved in this demo.' }); setForm(BLANK_PASSWORDS); setTried(false); return; }
    setBusy(true);
    try {
      await changePassword(form.current, form.next);
      setForm(BLANK_PASSWORDS);
      setTried(false);
      toast({ variant: 'success', message: 'Password changed. You are signed out on your other devices.' });
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'WRONG_PASSWORD') setWrongCurrent('Your current password is not correct');
      else setFailure(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="solid-panel settings__panel">
      <Form onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label="Change password">
        <FormSection title="Change password">
          {failure && <InlineAlert variant="danger" title={failure} />}
          <TextField label="Current password" type="password" autoComplete="current-password" value={form.current} onChange={(e) => set('current', e.target.value)} error={show('current')} />
          <TextField label="New password" type="password" autoComplete="new-password" value={form.next} onChange={(e) => set('next', e.target.value)} error={show('next')} helper={`At least ${MIN_PASSWORD} characters.`} />
          <TextField label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => set('confirm', e.target.value)} error={show('confirm')} />
          <p className="t-caption ink-2">You stay signed in here. Every other device is signed out.</p>
        </FormSection>
        <FormFooter><Button variant="primary" type="submit" loading={busy}>Change password</Button></FormFooter>
      </Form>
    </div>
  );
}

export function MyProfileScreen() {
  const { viewer } = useSession();
  const [params] = useSearchParams();
  const raw = params.get('section');
  const section = raw === 'personal' || raw === 'password' ? raw : 'work';
  const { state, data: person, retry } = useResource(() => getPerson(viewer.id), [viewer.id]);
  const pattern = useResource(() => getWorkingPattern(viewer.id), [viewer.id]);
  const versions = pattern.data ?? [];
  return (
    <>
      <PageHeader title={viewer.name} subtitle={viewer.title} lead={<Avatar name={viewer.name} size={36} />} />
      <SettingsLayout label="My profile" items={[{ label: 'Work details', to: '?section=work', active: section === 'work' }, { label: 'Personal details', to: '?section=personal', active: section === 'personal' }, { label: 'Password', to: '?section=password', active: section === 'password' }]}>
        {section === 'password' ? <ChangePassword /> : state !== 'ready' || !person
          ? <ListStateBlock state={state === 'ready' ? 'empty' : state} label="Your profile" onRetry={retry} capability="view your profile" empty={{ message: 'Your profile is not set up yet.', action: <GoTo to="/me/home">Back to My day</GoTo> }} />
          : section === 'work'
            ? (
              <div className="solid-panel settings__panel">
                <section className="stack-rows">
                  <h2 className="t-h3">Work details</h2>
                  <dl className="def-list">
                    <dt>Manager</dt><dd className="dt__person">{person.managerId ? <><Avatar name={personName(person.managerId)} size={20} />{personName(person.managerId)}</> : 'None'}</dd>
                    <dt>Office</dt><dd>{person.office}</dd>
                    <dt>Type</dt><dd>{person.type}</dd>
                    <dt>Projects</dt><dd className="t-numeric">{person.projects.join(', ') || 'None yet'}</dd>
                  </dl>
                </section>
                <section className="stack-rows">
                  <h2 className="t-h3">Working pattern</h2>
                  <EffectiveDatedList versions={versions} current={Math.max(0, versions.length - 1)} />
                  <p className="t-caption ink-2">Ask Farah Khan to change this.</p>
                </section>
              </div>
            )
            : <Personal name={person.name} />}
      </SettingsLayout>
    </>
  );
}

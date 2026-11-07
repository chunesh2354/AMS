import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getPerson, getWorkingPattern, personName } from '../../api';
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

export function MyProfileScreen() {
  const { viewer } = useSession();
  const [params] = useSearchParams();
  const section = params.get('section') === 'personal' ? 'personal' : 'work';
  const { state, data: person, retry } = useResource(() => getPerson(viewer.id), [viewer.id]);
  const pattern = useResource(() => getWorkingPattern(viewer.id), [viewer.id]);
  const versions = pattern.data ?? [];
  return (
    <>
      <PageHeader title={viewer.name} subtitle={viewer.title} lead={<Avatar name={viewer.name} size={36} />} />
      <SettingsLayout label="My profile" items={[{ label: 'Work details', to: '?section=work', active: section === 'work' }, { label: 'Personal details', to: '?section=personal', active: section === 'personal' }]}>
        {state !== 'ready' || !person
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

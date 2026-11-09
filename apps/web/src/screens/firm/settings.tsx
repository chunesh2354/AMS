import { useMemo, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { getImportPreview, getIntegrations, getSettingsLists, type ImportRow } from '../../api';
import { useResource } from '../../api/useResource';
import { isLive } from '../../api/live';
import { canSeeRates, canUseSettings, useSession, type Viewer } from '../../app/session';
import { FIRM_NAME, PEOPLE } from '../../mock/studio-meridian';
import { SettingsLayout } from '../../layouts/SettingsLayout';
import { WizardLayout } from '../../layouts/WizardLayout';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { FileDrop } from '../../ui/FileDrop';
import { Form, FormFooter, FormSection } from '../../ui/Form';
import { InlineAlert } from '../../ui/InlineAlert';
import { ListStateBlock } from '../../ui/ListState';
import { NumberField } from '../../ui/NumberField';
import { PageHeader } from '../../ui/PageHeader';
import { PermissionDenied } from '../../ui/PermissionDenied';
import { Select } from '../../ui/Select';
import { Skeleton } from '../../ui/Skeleton';
import { StatusChip } from '../../ui/StatusChip';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { GoTo } from '../shared/go-to';
import { AccountsSettings } from './accounts';
import { RatesSettings } from './rates';

const SECTIONS = [
  { key: 'profile', label: 'Profile' }, { key: 'permissions', label: 'Permissions' }, { key: 'accounts', label: 'Accounts' }, { key: 'rates', label: 'Rates' }, { key: 'calendars', label: 'Calendars' }, { key: 'work-categories', label: 'Work categories' },
  { key: 'templates', label: 'Templates' }, { key: 'approval-policies', label: 'Approval policies' }, { key: 'integrations', label: 'Integrations' }, { key: 'imports', label: 'Imports' },
];

/**
 * The settings sections this viewer may open. Rates goes to exactly those the server lets read the rate card
 * (rates.bill.manage or rates.cost.view): finance gets Rates alone, operations gets everything but Rates.
 */
export function settingsSectionsFor(viewer: Viewer) {
  const full = canUseSettings(viewer);
  const rates = canSeeRates(viewer);
  return SECTIONS.filter((s) => (s.key === 'rates' ? rates : full));
}

function Profile() {
  const toast = useToast();
  const { viewer } = useSession();
  const [name, setName] = useState(() => (isLive ? viewer.firm?.name ?? '' : FIRM_NAME));
  const [office, setOffice] = useState('Bengaluru');
  const [prefix, setPrefix] = useState('INV-DEMO-');
  const [terms, setTerms] = useState('30');
  const [tried, setTried] = useState(false);
  const badTerms = !(Number(terms) > 0);
  const save = () => {
    if (!name.trim() || badTerms) { setTried(true); return; }
    toast({ variant: 'success', message: 'Firm profile checked. Nothing is saved in this demo.' });
  };
  return (
    <div className="solid-panel settings__panel">
      <Form onSubmit={(e) => { e.preventDefault(); save(); }}>
        <FormSection title="Firm profile" columns={2}>
          <TextField label="Firm name" value={name} onChange={(e) => setName(e.target.value)} error={tried && !name.trim() ? 'Enter the firm name' : undefined} />
          <TextField label="Office" value={office} onChange={(e) => setOffice(e.target.value)} />
        </FormSection>
        <FormSection title="Invoicing" columns={2}>
          <TextField label="Invoice prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          <NumberField label="Payment terms (days)" value={terms} onChange={(e) => setTerms(e.target.value)} error={tried && badTerms ? 'Enter days above zero' : undefined} />
        </FormSection>
        <FormFooter summary={undefined}><span className="t-caption ink-2" style={{ marginRight: 'auto' }}>Changes apply to new records.</span><Button variant="primary" onClick={save}>Save</Button></FormFooter>
      </Form>
    </div>
  );
}

function ListSection({ section, title }: { section: string; title: string }) {
  const { state, data, retry } = useResource(getSettingsLists, []);
  const rows = data?.[section] ?? [];
  const columns: Column<{ name: string; detail: string }>[] = [
    { key: 'name', header: 'Name', value: (r) => r.name },
    { key: 'detail', header: 'Detail', value: (r) => r.detail },
    { key: 'status', header: 'Status', type: 'status', value: () => 'Enabled' },
  ];
  return (
    <>
      <h2 className="t-h2">{title}</h2>
      <DataTable label={title} columns={columns} rows={rows} rowKey={(r) => r.name} state={state === 'ready' && !rows.length ? 'empty' : state} onRetry={retry} capability="change firm settings" empty={{ message: `No ${title.toLowerCase()} are set up yet.`, action: <GoTo to="/firm/settings/imports">Start an import</GoTo> }} />
    </>
  );
}

function Integrations() {
  const toast = useToast();
  const { state, data, retry } = useResource(getIntegrations, []);
  if (state === 'loading') return <Skeleton kind="card" />;
  if (state !== 'ready') return <ListStateBlock state={state} label="Integrations" onRetry={retry} capability="change firm settings" empty={{ message: 'No integrations are available.', action: <GoTo to="/firm/settings/profile">Back to Profile</GoTo> }} />;
  return (
    <>
      <h2 className="t-h2">Integrations</h2>
      <div className="card-grid">
        {(data ?? []).map((i) => (
          <section key={i.name} className="card glass" aria-label={i.name}>
            <div className="panel__head"><h3 className="t-h3">{i.name}</h3><StatusChip size="sm" status={i.mode} /></div>
            <p className="t-body-sm ink-2" style={{ flex: 1 }}>{i.body}</p>
            <span><Button size="dense" onClick={() => toast({ variant: 'info', message: `${i.name} is not connected in this demo.` })}>{i.action}</Button></span>
          </section>
        ))}
      </div>
    </>
  );
}

const STEPS = ['Upload', 'Map columns', 'Preview', 'Review'];
const COLUMNS = ['Person', 'Title', 'Manager', 'Hours per week'];
const isManager = (m: string) => PEOPLE.some((p) => p.name === m);
const isHours = (h: string) => Number(h) > 0 && Number(h) <= 60;

function Imports() {
  const toast = useToast();
  const [params] = useSearchParams();
  const initial = useResource(getImportPreview, []);
  const [step, setStep] = useState(Math.min(3, Math.max(0, Number(params.get('step') ?? 1) - 1)));
  const [file, setFile] = useState<string | null>(params.get('step') ? 'people-import.csv' : null);
  const [fixes, setFixes] = useState<Record<number, Partial<ImportRow>>>({});
  const [tried, setTried] = useState(false);
  const rows = useMemo(() => (initial.data ?? []).map((r) => ({ ...r, ...fixes[r.row] })), [initial.data, fixes]);
  const errors = rows.filter((r) => !isManager(r.manager)).length + rows.filter((r) => !isHours(r.hours)).length;
  const blocked = (step === 0 && !file) || (step === 2 && errors > 0);
  const next = () => {
    if (blocked) { setTried(true); return; }
    setTried(false);
    if (step < STEPS.length - 1) { setStep(step + 1); return; }
    toast({ variant: 'success', message: `${rows.length} people are ready to import. Nothing is saved in this demo.` });
    setStep(0); setFile(null); setFixes({});
  };
  const edit = (row: number, patch: Partial<ImportRow>) => setFixes((f) => ({ ...f, [row]: { ...f[row], ...patch } }));
  const columns: Column<ImportRow>[] = [
    { key: 'row', header: 'Row', type: 'number', value: (r) => r.row },
    { key: 'person', header: 'Person', value: (r) => r.person },
    { key: 'title', header: 'Title', value: (r) => r.title },
    { key: 'manager', header: 'Manager', value: (r) => r.manager, cellError: (r) => !isManager(r.manager), onEdit: (r, v) => edit(r.row, { manager: v }) },
    { key: 'hours', header: 'Hours per week', value: (r) => r.hours, cellError: (r) => !isHours(r.hours), onEdit: (r, v) => edit(r.row, { hours: v }) },
  ];
  return (
    <WizardLayout
      steps={STEPS} current={step}
      footer={(
        <>
          {tried && blocked && <span className="form__summary" role="status">{step === 0 ? 'Choose a file first' : `Fix ${errors} ${errors === 1 ? 'cell' : 'cells'} to continue`}</span>}
          {step > 0 && <Button variant="ghost" onClick={() => { setTried(false); setStep(step - 1); }}>Back</Button>}
          <Button variant="primary" onClick={next}>{step === STEPS.length - 1 ? 'Run import' : 'Save and continue'}</Button>
        </>
      )}
    >
      {step === 0 && (
        <>
          <h2 className="t-h2">Upload</h2>
          <FileDrop label="People file" accept=".csv" files={file ? [{ name: file }] : []} onFiles={(f) => setFile(f[0]?.name ?? null)} error={tried && !file ? 'Choose a CSV file' : undefined} />
          {!file && <span><Button size="dense" variant="ghost" onClick={() => setFile('people-import.csv')}>Use the sample file</Button></span>}
        </>
      )}
      {step === 1 && (
        <>
          <h2 className="t-h2">Map columns</h2>
          <Form onSubmit={(e) => e.preventDefault()}>
            <FormSection columns={2}>
              {COLUMNS.map((c) => <Select key={c} label={c} options={COLUMNS.map((x) => ({ value: x, label: x }))} value={c} />)}
            </FormSection>
          </Form>
        </>
      )}
      {step === 2 && (
        <>
          <h2 className="t-h2">Preview</h2>
          {errors > 0
            ? <InlineAlert variant="danger" title={`${errors} ${errors === 1 ? 'cell needs' : 'cells need'} fixing before this import can run.`}>Select a red cell to correct it.</InlineAlert>
            : <InlineAlert variant="success" title="Every cell is valid." />}
          <DataTable label="Import preview" columns={columns} rows={rows} rowKey={(r) => String(r.row)} density="dense" state={initial.state === 'ready' ? 'ready' : initial.state} />
        </>
      )}
      {step === 3 && (
        <>
          <h2 className="t-h2">Review</h2>
          <dl className="def-list"><dt>File</dt><dd>{file}</dd><dt>People</dt><dd className="t-numeric">{rows.length}</dd><dt>Errors</dt><dd className="t-numeric">{errors}</dd></dl>
        </>
      )}
    </WizardLayout>
  );
}

export function SettingsScreen() {
  const { viewer } = useSession();
  const section = useParams()['*'] ?? 'profile';
  const sections = settingsSectionsFor(viewer);
  if (!sections.length) return (<><PageHeader title="Settings" /><div className="solid-panel"><PermissionDenied capability="change firm settings" /></div></>);
  const known = sections.find((s) => s.key === section);
  if (!known) return <Navigate to={`/firm/settings/${sections[0].key}`} replace />;
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsLayout label="Settings" items={sections.map((s) => ({ label: s.label, to: `/firm/settings/${s.key}` }))}>
        {section === 'profile' && <Profile />}
        {section === 'integrations' && <Integrations />}
        {section === 'imports' && <Imports />}
        {section === 'accounts' && <AccountsSettings />}
        {section === 'rates' && <RatesSettings />}
        {!['profile', 'integrations', 'imports', 'accounts', 'rates'].includes(section) && <ListSection section={section} title={known.label} />}
      </SettingsLayout>
    </>
  );
}

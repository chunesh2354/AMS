import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { getFiles, getProjectPhaseOptions, personName, type FileDoc } from '../../../api';
import { useResource } from '../../../api/useResource';
import { Button } from '../../../ui/Button';
import { DataTable, type Column } from '../../../ui/DataTable';
import { FilterBar, type FilterDef } from '../../../ui/FilterBar';
import { Form, FormSection } from '../../../ui/Form';
import { Select } from '../../../ui/Select';
import { Sheet } from '../../../ui/Sheet';
import { TextField } from '../../../ui/TextField';
import { useToast } from '../../../ui/Toast';
import { isLive } from '../../../api/live';
import { NotAvailable } from '../../../ui/NotAvailable';

function MockProjectFilesScreen() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const toast = useToast();
  const { state, data, retry } = useResource(() => getFiles(id), [id]);
  const [linking, setLinking] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const all = data ?? [];
  const q = params.get('q')?.toLowerCase() ?? '';
  const rows = all.filter((f) => (!params.get('phase') || f.phase === params.get('phase')) && (!q || f.name.toLowerCase().includes(q)));
  const filters: FilterDef[] = [
    { type: 'search', key: 'q', label: 'Search documents' },
    { type: 'select', key: 'phase', label: 'Phase', options: [...new Set(all.map((f) => f.phase))].map((p) => ({ value: p, label: p })) },
  ];
  const columns: Column<FileDoc>[] = [
    { key: 'name', header: 'Document', value: (f) => f.name, sortable: true },
    { key: 'version', header: 'Version', value: (f) => f.version, render: (f) => <span className="chip chip--sm tone-neutral t-numeric">{f.version}</span> },
    { key: 'phase', header: 'Phase', value: (f) => f.phase, sortable: true },
    { key: 'by', header: 'Linked by', type: 'person', value: (f) => personName(f.byId) },
    { key: 'updated', header: 'Updated', type: 'date', value: (f) => f.updated, sortable: true },
  ];
  const close = () => { setLinking(false); setName(''); setUrl(''); setPhase(null); setTried(false); };
  const save = () => {
    if (!name.trim() || !url.trim()) { setTried(true); return; }
    toast({ variant: 'success', message: `${name.trim()} linked in this view. Nothing is saved in this demo.` });
    close();
  };
  const link = <Button variant="primary" onClick={() => setLinking(true)}>Link document</Button>;
  return (
    <>
      <div className="toolbar toolbar--between"><h2 className="t-h2">Files</h2>{link}</div>
      <FilterBar filters={filters} />
      <DataTable
        label="Project files" columns={columns} rows={rows} rowKey={(f) => f.id} state={state === 'ready' && !rows.length ? 'empty' : state} onRetry={retry}
        capability="view project files" empty={{ message: 'No documents are linked to this project yet.', action: link }}
      />
      <Sheet open={linking} onClose={close} title="Link document" dirty={name !== '' || url !== ''} footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" onClick={save}>Link document</Button></>}>
        <Form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <FormSection>
            <TextField label="Document name" value={name} onChange={(e) => setName(e.target.value)} error={tried && !name.trim() ? 'Name the document' : undefined} />
            <TextField label="Link" value={url} onChange={(e) => setUrl(e.target.value)} helper="Where the document lives. This app links to files and does not store them." error={tried && !url.trim() ? 'Paste the link' : undefined} />
            <Select label="Phase" options={(getProjectPhaseOptions().find((p) => p.code === id)?.phases ?? []).map((p) => ({ value: p.name, label: p.name }))} value={phase} onChange={setPhase} />
          </FormSection>
        </Form>
      </Sheet>
    </>
  );
}

/** Live mode has no API for this yet: the honest empty state, never the sample studio. */
export function ProjectFilesScreen() {
  return isLive ? <><h2 className="t-h2">Files</h2><div className="solid-panel"><NotAvailable detail="Drawings, documents and their revisions for this project." /></div></> : <MockProjectFilesScreen />;
}

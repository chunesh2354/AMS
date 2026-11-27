import { useState } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useOverlays } from '../../app/overlays';
import { getProject } from '../../api';
import { useResource } from '../../api/useResource';
import { isLive } from '../../api/live';
import { getLiveProject, isLiveProject } from '../../api/live/projects';
import { useSession } from '../../app/session';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { InlineAlert } from '../../ui/InlineAlert';
import { PageHeader } from '../../ui/PageHeader';
import { StatusChip } from '../../ui/StatusChip';
import { ProjectStatusMenu } from './project-status';

const TABS = ['phases', 'tasks', 'timeline', 'staffing', 'time', 'costs', 'billing', 'changes', 'files', 'activity'];

export function ProjectLayout() {
  const { id = '' } = useParams();
  const { openLogTime } = useOverlays();
  const { viewer } = useSession();
  const { state, data: p, retry } = useResource(() => (isLive ? getLiveProject(id) : getProject(id, viewer)), [id, viewer.id]);
  /** Bumped after a status change: the header reloads and the tab remounts, so both read the new status. */
  const [version, setVersion] = useState(0);
  const reload = () => { retry(); setVersion((v) => v + 1); };
  const live = isLiveProject(p) ? p : null;
  const holdReason = live?.live.holdReason;
  const base = `/firm/projects/${id}`;
  if (state === 'ready' && !p) {
    return (
      <>
        <PageHeader title="Project" breadcrumb={[{ label: 'Projects', to: '/firm/projects' }, { label: id }]} />
        <div className="solid-panel"><EmptyState message="No project has that code." /></div>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title={p?.name ?? id}
        breadcrumb={[{ label: 'Projects', to: '/firm/projects' }, { label: id }]}
        meta={p && (
          <>
            <StatusChip size="sm" status={p.status} />
            {p.risk.status !== p.status && p.risk.label !== 'On track' && <StatusChip size="sm" status={p.risk.status} label={p.risk.label} />}
            <span className="t-body-sm ink-2">{p.client} · {p.contract}</span>
          </>
        )}
        secondaryActions={live && <ProjectStatusMenu code={live.code} status={live.status} permissions={live.live.permissions} onChanged={reload} />}
        primaryAction={<Button variant="primary" onClick={() => openLogTime()}>Log time</Button>}
        tabs={[{ label: 'Overview', to: base, end: true }, ...TABS.map((t) => ({ label: t[0].toUpperCase() + t.slice(1), to: `${base}/${t}` }))]}
      />
      {p?.status === 'On hold' && (
        <InlineAlert variant="info" title={`${p.code} is on hold`}>
          {holdReason ? `${holdReason.trim().replace(/\.+$/, '')}. ` : ''}Allocations are retained until the hold is lifted.
        </InlineAlert>
      )}
      {p?.status === 'Archived' && <InlineAlert variant="info" title={`${p.code} is archived`}>It takes no new time. Restore it before changing it.</InlineAlert>}
      <Outlet key={version} />
    </>
  );
}

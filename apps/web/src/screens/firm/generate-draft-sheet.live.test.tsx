import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../ui/Toast';
import type { ReadyItem } from '../../api';
import { LiveGenerateDraftSheet } from './generate-draft-sheet';

vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

let posted: unknown = null;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  if (String(input).endsWith('/billing/drafts') && init.method === 'POST') {
    posted = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: 'd1', draft_no: 'DRAFT-0013' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: 404 });
});
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); posted = null; });
afterEach(() => vi.unstubAllGlobals());

const item = (id: string, project: string, projectName: string): ReadyItem => ({ id, project, projectName, component: 'Fixed fee', basis: 'Fixed fee claim', status: 'Eligible', amount: 80000 } as ReadyItem);
const openSheet = (items: ReadyItem[]) => render(<ToastProvider><LiveGenerateDraftSheet open onClose={() => {}} items={items} onCreated={() => {}} /></ToastProvider>);

describe('Generate billing draft, live mode', () => {
  it('preselects the project when only one has lines ready, as on a project Billing tab', async () => {
    openSheet([item('a', 'PRJ-01', 'Lakeview Residence'), item('b', 'PRJ-01', 'Lakeview Residence')]);
    const sheet = await screen.findByRole('dialog', { name: 'Generate billing draft' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(posted).toMatchObject({ project: 'PRJ-01' }));
  });

  it('still asks which project when several have lines ready', async () => {
    openSheet([item('a', 'PRJ-01', 'Lakeview Residence'), item('b', 'PRJ-02', 'Orchard Block')]);
    const sheet = await screen.findByRole('dialog', { name: 'Generate billing draft' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Create draft' }));
    // The placeholder and the field error both read 'Choose a project'.
    expect(within(sheet).getAllByText('Choose a project')).toHaveLength(2);
    expect(posted).toBeNull();
  });
});

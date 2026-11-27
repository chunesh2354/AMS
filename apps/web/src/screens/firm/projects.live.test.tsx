import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../app/session';
import { ToastProvider } from '../../ui/Toast';
import { ProjectsScreen } from './projects';

// Live mode: the Status filter offers the statuses the projects really have, in lifecycle order.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  const body = url.endsWith('/me') ? ME : url.endsWith('/projects') ? { data: PROJECTS, page: 1, page_size: 50, total: PROJECTS.length, complete: true, missing_count: 0 } : null;
  return new Response(JSON.stringify(body ?? { error: { code: 'NOT_FOUND', message: 'Not found' } }), { status: body ? 200 : 404, headers: { 'Content-Type': 'application/json' } });
});
const ME = {
  person: { id: 'u-p', ref_code: 'Q01', name: 'Mira Shah', work_email: 'm@firm.test', job_title: 'Principal', manager_id: null },
  firm: { id: 'f', trading_name: 'Test Studio', legal_name: 'x', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['principal'], capabilities: { 'projects.plan': 'firm' }, led_projects: [], member_projects: [],
};
const P = (code: string, name: string, status: string) => ({
  id: code, code, name, client: 'Port Trust', client_id: 'c1', status, hold_reason: null, contract: null, pm: { id: 'u-p', ref_code: 'Q01', name: 'Mira Shah' },
  hours: { budget: '100.00', actual: '10.00', forecast: '50.00' }, delivery_progress_pct: 10, entitlement: { restricted: true }, contribution: { restricted: true }, phases: [],
});
const PROJECTS = [P('LV-04', 'Old Pier', 'Archived'), P('LV-01', 'Harbour Pavilion', 'Active'), P('LV-03', 'Dune House', 'Delivery complete'), P('LV-02', 'Salt Store', 'On hold')];

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe('projects list status filter, live', () => {
  it('offers each status that appears, in lifecycle order, and filters On hold, Delivery complete and Archived', async () => {
    render(
      <SessionProvider><ToastProvider><MemoryRouter initialEntries={['/firm/projects']}>
        <Routes><Route path="/firm/projects" element={<ProjectsScreen />} /></Routes>
      </MemoryRouter></ToastProvider></SessionProvider>,
    );
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('rowheader')).toHaveLength(4);
    for (const [status, name] of [['On hold', 'Salt Store'], ['Delivery complete', 'Dune House'], ['Archived', 'Old Pier']]) {
      await userEvent.click(screen.getByRole('button', { name: /^Status/ }));
      const items = (await screen.findAllByRole('menuitem')).map((b) => b.textContent);
      expect(items).toEqual(['Active', 'On hold', 'Delivery complete', 'Archived']);
      await userEvent.click(screen.getByRole('menuitem', { name: status }));
      await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(1));
      expect(screen.getByRole('table')).toHaveTextContent(name);
      // Choosing the same status again clears the filter.
      await userEvent.click(screen.getByRole('button', { name: /^Status/ }));
      await userEvent.click(await screen.findByRole('menuitem', { name: status }));
      await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('rowheader')).toHaveLength(4));
    }
  });
});
